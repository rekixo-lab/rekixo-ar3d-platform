import {env} from "cloudflare:workers";
import {sameOrigin} from "@/modules/auth";
import {clientSalesAccess,canEdit,salesResponse,salesAudit,salesId} from "@/app/sales-accounts-server";
const mimes=new Set(["application/pdf","image/png","image/jpeg"]);
export async function GET(request:Request){
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 const {projectId}=access.context, url=new URL(request.url);
 const saleId=salesId(url.searchParams.get("saleId"));
 if(!saleId)return salesResponse({error:"Sale ID required"},400);
 const documentId=salesId(url.searchParams.get("documentId"));
 if(documentId){
  const row=await env.DB.prepare("SELECT file_name AS fileName,content_type AS contentType,object_key AS objectKey FROM sale_documents WHERE project_id=? AND sale_id=? AND id=? AND archived_at IS NULL LIMIT 1")
   .bind(projectId,saleId,documentId).first<{fileName:string;contentType:string;objectKey:string}>();
  if(!row)return salesResponse({error:"Document not found"},404);
  const obj=await env.BUCKET.get(row.objectKey);
  if(!obj?.body)return salesResponse({error:"Document storage unavailable"},503);
  const name=row.fileName.replace(/[^\p{L}\p{N} ._-]/gu,"_").slice(0,120);
  return new Response(obj.body,{headers:{"content-type":row.contentType,
   "content-disposition":`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
   "cache-control":"private, no-store","x-content-type-options":"nosniff"}});
 }
 const rows=await env.DB.prepare(`SELECT id,kind,file_name AS fileName,content_type AS contentType,
   size_bytes AS sizeBytes,sha256,uploaded_at AS uploadedAt,archived_at AS archivedAt
   FROM sale_documents WHERE project_id=? AND sale_id=? ORDER BY uploaded_at DESC,id`)
  .bind(projectId,saleId).all();
 return salesResponse({documents:rows.results});
}
export async function POST(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 if(!canEdit(access.context.role))return salesResponse({error:"Sales editor access required"},403);
 if(Number(request.headers.get("content-length")||0)>9*1024*1024)return salesResponse({error:"Document too large"},413);
 const form=await request.formData().catch(()=>null);
 if(!form)return salesResponse({error:"Invalid multipart upload"},400);
 const saleId=salesId(form.get("saleId")),kind=String(form.get("kind")||"");
 const file=form.get("file");
 if(!saleId||!["agreement","receipt","other"].includes(kind)||
   !(file instanceof File)||!mimes.has(file.type)||file.size<1||file.size>8*1024*1024)
  return salesResponse({error:"PDF, PNG or JPEG under 8 MB required"},400);
 const {projectId,userId}=access.context;
 const sale=await env.DB.prepare("SELECT id FROM property_sales WHERE project_id=? AND id=? AND state='active'")
  .bind(projectId,saleId).first();
 if(!sale)return salesResponse({error:"Active sale not found"},404);
 const id=crypto.randomUUID(),name=file.name.trim().slice(0,160)||"document";
 const key=`projects/${projectId}/private/sales/${saleId}/${id}`;
 const bytes=await file.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(n=>n.toString(16).padStart(2,"0")).join("");
 try{
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});
  try{
   await env.DB.prepare(`INSERT INTO sale_documents
   (project_id,id,sale_id,kind,file_name,content_type,size_bytes,object_key,sha256,uploaded_by,uploaded_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(projectId,id,saleId,kind,name,file.type,file.size,key,hash,userId,new Date().toISOString()).run();
  }catch(err){await env.BUCKET.delete(key).catch(()=>{});throw err;}
  try{await salesAudit(access.context,"sales.document_uploaded",saleId,{documentId:id,kind,hash});}catch{console.error("Document saved but audit failed",{id});}
  return salesResponse({ok:true,documentId:id},201);
 }catch(error){console.error("Private document upload failed",error);return salesResponse({error:"Document upload failed"},500);}
}

export async function PATCH(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 if(!canEdit(access.context.role))return salesResponse({error:"Editor permission required"},403);
 const body=await request.json().catch(()=>null) as {action?:string;saleId?:string;documentId?:string;reason?:string}|null;
 const saleId=salesId(body?.saleId),documentId=salesId(body?.documentId);
 const reason=typeof body?.reason==="string"?body.reason.trim():"";
 if(!saleId||!documentId||reason.length<3||reason.length>300)
  return salesResponse({error:"Document and reason required"},400);
 const {projectId,userId}=access.context;
 const archive=body?.action==="archive",restore=body?.action==="restore";
 if(!archive&&!restore)return salesResponse({error:"Unsupported document action"},400);
 try{
  const result=await env.DB.prepare(`UPDATE sale_documents SET
    archived_at=?,archived_by=?,archive_reason=?
    WHERE project_id=? AND id=? AND sale_id=?
      AND ${archive?"archived_at IS NULL":"archived_at IS NOT NULL"}
      AND EXISTS(SELECT 1 FROM property_sales s WHERE s.project_id=sale_documents.project_id
        AND s.id=sale_documents.sale_id AND s.state='active')`)
   .bind(archive?new Date().toISOString():null,archive?userId:null,archive?reason:null,projectId,documentId,saleId).run();
  if(!result.meta.changes)return salesResponse({error:"Document unavailable or already changed"},409);
  try{await salesAudit(access.context,archive?"sales.document_archived":"sales.document_restored",saleId,{documentId,reason})}catch{console.error("Document correction audit unavailable",{documentId})}
  return salesResponse({ok:true});
 }catch(error){console.error("Document archive/restore failed",error);return salesResponse({error:"Document correction failed"},409)}
}
