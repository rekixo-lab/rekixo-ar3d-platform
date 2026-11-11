import { and, desc, eq } from "drizzle-orm";
import { publicSafeText } from "@/app/customer-direction-policy";
import { getDb } from "@/modules/db";
import { gallery } from "@/modules/db/schema";
import { publicProjectId } from "@/modules/projects";
import { publicSiteEnabled, publicSiteUnavailableResponse } from "@/modules/public-site-access";

export async function GET(request:Request){
  const projectId=await publicProjectId(request);
  const category=new URL(request.url).searchParams.get("category")==="amenity"?"amenity":"gallery";
  if(!projectId)return Response.json({error:"Published project nahi mila"},{status:404,headers:{"cache-control":"no-store"}});
  if(!(await publicSiteEnabled(projectId)))return publicSiteUnavailableResponse();
  const items=await getDb()
    .select({id:gallery.id,caption:gallery.caption,filename:gallery.filename,sortOrder:gallery.sortOrder})
    .from(gallery)
    .where(and(eq(gallery.projectId,projectId),eq(gallery.category,category)))
    .orderBy(desc(gallery.sortOrder));
  return Response.json(
    {projectId,gallery:items.map((item)=>({ ...item,caption:publicSafeText(projectId,item.caption),filename:publicSafeText(projectId,item.filename) }))},
    {headers:{"cache-control":"public,max-age=30,stale-while-revalidate=120","x-rekixo-gallery-metadata":"1"}},
  );
}
