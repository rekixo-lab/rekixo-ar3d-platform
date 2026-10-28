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
export const indiaDate=(isoTime:string)=>new Date(new Date(isoTime).getTime()+330*60*1000).toISOString().slice(0,10);
export const publicNoticeLabel=(label:string)=>label.trim().toLowerCase()==="hold"?"On Hold":label.trim();

// Only user-visible inventory/deal status events are eligible for automatic
// public notices. Never copy free-text notes, buyer, sale, price or actor info.
export async function recordAutomaticPlotNotice(projectId:string,plotId:string,category:"inventory"|"deal",label:string,sourceEventId:string,actorId:string,isoTime:string){
 const eventDate=indiaDate(isoTime),cleanLabel=publicNoticeLabel(label);
 if(!noticeLabel(cleanLabel)||!plotId||plotId.length>80)return;
 const plotIdsJson=JSON.stringify([plotId]);
 // Exactly one automatic notice for each plot, category and IST day. A second
 // status change replaces that plot's earlier announcement rather than
 // displaying two conflicting statuses. Hidden notices remain suppressed.
 const stableId="auto:"+eventDate+":"+category+":"+plotId;
 try{
  const flag=await env.DB.prepare(
   "SELECT 1 AS enabled FROM project_plot_notice_settings WHERE project_id=? AND enabled=1"
  ).bind(projectId).first();
  if(!flag)return;
  const active=await env.DB.prepare(
   "SELECT id FROM plots WHERE project_id=? AND id=? AND inventory_active=1"
  ).bind(projectId,plotId).first();
  if(!active)return;
  const updated=await env.DB.prepare(
   "UPDATE project_plot_notices SET label=?,state='published',published_at=?,updated_at=? "+
   "WHERE project_id=? AND event_date=? AND category=? AND plot_ids_json=? "+
   "AND source='automatic' AND state IN ('draft','published')"
  ).bind(cleanLabel,isoTime,isoTime,projectId,eventDate,category,plotIdsJson).run();
  if(Number(updated.meta.changes)>0)return;
  await env.DB.prepare(
   "INSERT OR IGNORE INTO project_plot_notices(project_id,id,event_date,category,label,plot_ids_json,state,source,source_event_id,created_by,created_at,published_at,updated_at) "+
   "SELECT ?,?,?,?,?,?,'published','automatic',?,?,?,?,? "+
   "WHERE NOT EXISTS (SELECT 1 FROM project_plot_notices WHERE project_id=? AND event_date=? AND category=? AND plot_ids_json=? AND source='automatic')"
  ).bind(projectId,crypto.randomUUID(),eventDate,category,cleanLabel,plotIdsJson,
   stableId,actorId,isoTime,isoTime,isoTime,
   projectId,eventDate,category,plotIdsJson).run();
 }catch(error){console.error("Automatic plot notice could not be published",error)}
 // Notice publication is a best-effort side effect of a successfully committed
 // domain mutation; it never blocks or rolls back original plot inventory.
 void sourceEventId;
}
