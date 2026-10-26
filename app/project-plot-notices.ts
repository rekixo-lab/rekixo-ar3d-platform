import {env} from "cloudflare:workers";

export const noticeDate=(raw:unknown):raw is string=>{
 if(typeof raw!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false;
 const d=new Date(raw+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===raw;
};
export const noticeIds=(raw:unknown):string[]|null=>{
 if(!Array.isArray(raw)||raw.length<1||raw.length>35||!raw.every(v=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=80))return null;
 const ids=raw.map(v=>String(v).trim());
 return new Set(ids).size===ids.length?ids:null;
};
export const noticeLabel=(v:unknown)=>typeof v==="string"&&v.trim().length>=2&&v.trim().length<=70&&!/[\u0000-\u001f<>]/.test(v);
export type NoticeRecord={id:string;eventDate:string;category:"inventory"|"deal";label:string;plotIds:string[];state:"draft"|"published"|"hidden";source:string;createdAt:string;publishedAt:string|null};
export function parseNoticeRows(rows:Record<string,unknown>[]):NoticeRecord[]{
 return rows.flatMap(row=>{
  let ids:unknown;try{ids=JSON.parse(String(row.plotIdsJson))}catch{return []}
  const plotIds=noticeIds(ids);
  if(!plotIds)return [];
  return [{
   id:String(row.id),eventDate:String(row.eventDate),category:row.category==="inventory"?"inventory" as const:"deal" as const,
   label:String(row.label),plotIds,state:row.state==="published"?"published" as const:row.state==="hidden"?"hidden" as const:"draft" as const,
   source:String(row.source),createdAt:String(row.createdAt),publishedAt:row.publishedAt?String(row.publishedAt):null,
  }];
 });
}
export async function recordPrivatePlotNotice(projectId:string,plotId:string,category:"inventory"|"deal",label:string,sourceEventId:string,actorId:string,isoTime:string){
 // Best-effort event drafting, never block an already-saved canonical inventory or deal edit.
 // This operation cannot publish anything, or modify its source plot.
 if(!noticeLabel(label))return;
 try{
  await env.DB.prepare(
   "INSERT OR IGNORE INTO project_plot_notices(project_id,id,event_date,category,label,plot_ids_json,state,source,source_event_id,created_by,created_at,updated_at) "+
   "SELECT ?,?,?,?,?,?,'draft','automatic',?,?,?,? "+
   "WHERE EXISTS (SELECT 1 FROM project_plot_notice_settings WHERE project_id=? AND enabled=1) "+
   "AND EXISTS (SELECT 1 FROM plots WHERE project_id=? AND id=? AND inventory_active=1)"
  ).bind(projectId,crypto.randomUUID(),isoTime.slice(0,10),category,label,JSON.stringify([plotId]),sourceEventId,actorId,isoTime,isoTime,projectId,projectId,plotId).run();
 }catch(error){console.error("Private plot notice could not be drafted",error)}
}
