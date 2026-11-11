import { env } from "cloudflare:workers";
import { and,eq } from "drizzle-orm";
import { getDb } from "@/modules/db";
import { gallery } from "@/modules/db/schema";
import { sameOrigin,validAdminSession } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
const denied=()=>Response.json({error:"Admin login required"},{status:401});
const MAX_IMAGES_PER_CATEGORY=20;
type ImageCategory="gallery"|"amenity";
export async function POST(request:Request){
  if(!sameOrigin(request))return Response.json({error:"Invalid request origin"},{status:403});
  const session=await validAdminSession();
  if(!session)return denied();
  try{
    const projectId=session.projectId;
    const form=await request.formData();
    const categoryValue=String(form.get("category")||"gallery");
    if(categoryValue!=="gallery"&&categoryValue!=="amenity")
      return Response.json({error:"Invalid image category"},{status:400});
    const category:ImageCategory=categoryValue;
    const file=form.get("file"),allowed=["image/jpeg","image/png","image/webp"];
    if(!(file instanceof File)||!allowed.includes(file.type)||file.size<1)
      return Response.json({error:"Sirf JPG, PNG ya WebP image chunein"},{status:400});
    if(file.size>8*1024*1024)
      return Response.json({error:"Image 8 MB se chhoti honi chahiye"},{status:400});
    const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM gallery WHERE project_id=? AND category=?")
      .bind(projectId,category).first<{count:number}>();
    if(Number(count?.count||0)>=MAX_IMAGES_PER_CATEGORY)
      return Response.json({error:`${category==="amenity"?"Amenities":"Gallery"} me maximum 20 images rakh sakte hain`},{status:409});
    const id=crypto.randomUUID(),safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-")||"image";
    const objectKey=`projects/${projectId}/${category==="amenity"?"amenities":"gallery"}/${id}-${safe}`;
    const row={projectId,id,objectKey,filename:file.name.slice(0,240),contentType:file.type,
      caption:String(form.get("caption")??"").slice(0,300),category,sortOrder:Date.now(),createdAt:new Date().toISOString()};
    await env.BUCKET.put(objectKey,file.stream(),{httpMetadata:{contentType:file.type}});
    try{
      // The conditional D1 insert enforces each 20-image cap during concurrent uploads.
      const result=await env.DB.prepare(`INSERT INTO gallery
        (project_id,id,object_key,filename,content_type,caption,category,sort_order,created_at)
        SELECT ?,?,?,?,?,?,?,?,?
        WHERE (SELECT COUNT(*) FROM gallery WHERE project_id=? AND category=?)<20`)
        .bind(projectId,id,objectKey,row.filename,row.contentType,row.caption,category,row.sortOrder,row.createdAt,projectId,category).run();
      if(result.meta?.changes!==1){
        await env.BUCKET.delete(objectKey).catch((error)=>console.error("Gallery R2 cleanup pending",error));
        return Response.json({error:"20-image limit reached. Refresh and retry."},{status:409});
      }
    }catch(error){
      await env.BUCKET.delete(objectKey).catch((cleanup)=>console.error("Gallery R2 cleanup pending",cleanup));
      throw error;
    }
    await writeAudit(session,`project.${category}_uploaded`,projectId,id,{filename:row.filename});
    return Response.json({item:row},{status:201});
  }catch(error){
    console.error("Gallery upload failed",error);
    return Response.json({error:"Image save nahi hui. Dobara try karein."},{status:500});
  }
}
export async function DELETE(request:Request){
  if(!sameOrigin(request))return Response.json({error:"Invalid request origin"},{status:403});
  const session=await validAdminSession();
  if(!session)return denied();
  const id=new URL(request.url).searchParams.get("id");
  if(!id)return Response.json({error:"Missing id"},{status:400});

  const db=getDb();
  const where=and(eq(gallery.projectId,session.projectId),eq(gallery.id,id));
  const [item]=await db.select().from(gallery).where(where).limit(1);
  if(!item)return Response.json({ok:true,objectDeleted:true,cleanupPending:false});

  // D1 is the authorization source for public gallery bytes. Remove the row
  // first so an R2 cleanup failure can never leave a deleted image public.
  const actorIdentity=session.loginId||session.email;
  const now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gallery WHERE project_id=? AND id=?").bind(session.projectId,id),
    env.DB.prepare("INSERT INTO audit_logs (id,actor_id,actor_email,action,project_id,target_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),session.id,actorIdentity,"project.gallery_deleted",session.projectId,id,JSON.stringify({filename:item.filename}),now),
  ]);

  let objectDeleted=true;
  try{
    await env.BUCKET.delete(item.objectKey);
  }catch(error){
    objectDeleted=false;
    console.error("Gallery R2 cleanup deferred",error);
  }
  return Response.json({
    ok:true,
    objectDeleted,
    cleanupPending:!objectDeleted,
  });
}
