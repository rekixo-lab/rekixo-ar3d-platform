import {env} from "cloudflare:workers";
import {validAdminSession,sameOrigin} from "@/modules/auth";
import {noticeDate,noticeIds,noticeLabel,parseNoticeRows} from "@/app/project-plot-notices";
import {writeAudit} from "@/modules/audit";
const answer=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"private, no-store"}});
async function actor(){const session=await validAdminSession();return session?.role==="client_admin"?session:null}
async function feature(id:string){const row=await env.DB.prepare("SELECT enabled FROM project_plot_notice_settings WHERE project_id=?").bind(id).first<{enabled:number}>();return row?.enabled===1}
export async function GET(){
 const session=await actor();if(!session)return answer({error:"Client Admin login required"},401);
 const enabled=await feature(session.projectId);if(!enabled)return answer({enabled:false,notices:[]});
 const rows=await env.DB.prepare("SELECT id,event_date AS eventDate,category,label,plot_ids_json AS plotIdsJson,state,source,created_at AS createdAt,published_at AS publishedAt FROM project_plot_notices WHERE project_id=? ORDER BY event_date DESC,created_at DESC,id DESC LIMIT 120").bind(session.projectId).all<Record<string,unknown>>();
 return answer({enabled,notices:parseNoticeRows(rows.results)});
}
export async function POST(req:Request){
 if(!sameOrigin(req))return answer({error:"Invalid origin"},403);
 const session=await actor();if(!session)return answer({error:"Client Admin login required"},401);
 if(!await feature(session.projectId))return answer({error:"Notifications disabled for this project"},403);
 let b:Record<string,unknown>;try{const raw=await req.text();if(raw.length>4500)throw Error();b=JSON.parse(raw);if(!b||typeof b!=="object"||Array.isArray(b))throw Error()}catch{return answer({error:"Invalid request"},400)}
 const ids=noticeIds(b.plotIds);
 if(!ids||!noticeDate(b.eventDate)||!noticeLabel(b.label)||!["inventory","deal"].includes(String(b.category)))return answer({error:"Invalid notice fields"},400);
 const q="SELECT id FROM plots WHERE project_id=? AND inventory_active=1 AND id IN ("+ids.map(()=>"?").join(",")+")";
 const verified=await env.DB.prepare(q).bind(session.projectId,...ids).all();
 if(verified.results.length!==ids.length)return answer({error:"Plot numbers are not active in this project"},409);
 const now=new Date().toISOString(),id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO project_plot_notices(project_id,id,event_date,category,label,plot_ids_json,state,source,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft','manual',?,?,?)").bind(session.projectId,id,b.eventDate,b.category,String(b.label).trim(),JSON.stringify(ids),session.id,now,now).run();
 await writeAudit(session,"project.plot_notice_draft",session.projectId,id,{eventDate:b.eventDate,plotIds:ids});
 return answer({ok:true,id,state:"draft"},201);
}

export async function PATCH(req:Request){
 if(!sameOrigin(req))return answer({error:"Invalid origin"},403);
 const session=await actor();if(!session)return answer({error:"Client Admin login required"},401);
 if(!await feature(session.projectId))return answer({error:"Notifications disabled for this project"},403);
 let b:Record<string,unknown>;try{const raw=await req.text();if(raw.length>8000)throw Error();b=JSON.parse(raw);if(!b||typeof b!=="object"||Array.isArray(b))throw Error()}catch{return answer({error:"Invalid request"},400)}
 // Client-owned reviewed bulk publish: one transaction, strictly this session's project.
 // The UI shows grouped updates, but each underlying event remains auditable.
 if(Array.isArray(b.ids)){
  const ids=b.ids;
  const nextState=String(b.state||"");
  if(!["published","draft","hidden"].includes(nextState)||ids.length<1||ids.length>50||
     !ids.every(id=>typeof id==="string"&&id.length>0&&id.length<=110)||
     new Set(ids).size!==ids.length)return answer({error:"Choose 1 to 50 valid draft updates"},400);
  const placeholders=ids.map(()=>"?").join(",");
  const rows=await env.DB.prepare(
   "SELECT id,event_date AS eventDate,label,plot_ids_json AS plotIdsJson,state FROM project_plot_notices WHERE project_id=? AND id IN ("+placeholders+")"
  ).bind(session.projectId,...ids).all<{id:string;eventDate:string;label:string;plotIdsJson:string;state:string}>();
  if(rows.results.length!==ids.length||rows.results.some(r=>r.state===nextState))
   return answer({error:"Some updates have changed. Refresh before updating."},409);
  if(nextState==="published"){
   for(const item of rows.results){
    let parsed:unknown;try{parsed=JSON.parse(item.plotIdsJson)}catch{return answer({error:"Invalid draft"},409)}
    const plotIds=noticeIds(parsed);
    if(!plotIds||!noticeDate(item.eventDate)||!noticeLabel(item.label))
     return answer({error:"Invalid draft data"},409);
    const actual=await env.DB.prepare(
     "SELECT COUNT(*) AS total FROM plots WHERE project_id=? AND inventory_active=1 AND id IN ("+plotIds.map(()=>"?").join(",")+")"
    ).bind(session.projectId,...plotIds).first<{total:number}>();
    if(Number(actual?.total)!==plotIds.length)
     return answer({error:"A draft contains inactive or missing plot numbers. Correct it before publication."},409);
   }
  }
  const now=new Date().toISOString();
  const previousById=new Map(rows.results.map(row=>[row.id,row.state]));
  const statements=ids.map(id=>env.DB.prepare(
   "UPDATE project_plot_notices SET state=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END,updated_at=? WHERE project_id=? AND id=? AND state=? RETURNING id"
  ).bind(nextState,nextState,now,now,session.projectId,id,previousById.get(id)));
  const results=await env.DB.batch(statements);
  if(results.some(result=>!result.results?.length))
   return answer({error:"Some entries changed. Refresh to see their latest state."},409);
  await writeAudit(session,"project.plot_notice_bulk_state",session.projectId,"batch",{count:ids.length,ids,state:nextState});
  return answer({ok:true,updated:ids.length,state:nextState});
 }
 const id=typeof b.id==="string"?b.id:"",state=String(b.state||"");
 if(!id||id.length>110||!["published","draft","hidden"].includes(state))return answer({error:"Invalid update"},400);
 const existing=await env.DB.prepare("SELECT event_date AS eventDate,label,plot_ids_json AS plotIdsJson,state FROM project_plot_notices WHERE project_id=? AND id=?").bind(session.projectId,id).first<{eventDate:string;label:string;plotIdsJson:string;state:string}>();
 if(!existing)return answer({error:"Notification not found"},404);
 let ids:unknown;try{ids=JSON.parse(existing.plotIdsJson)}catch{return answer({error:"Invalid notice"},409)}
 if(!noticeDate(existing.eventDate)||!noticeLabel(existing.label)||!noticeIds(ids))return answer({error:"Notification data invalid"},409);
 if(state==="published"&&existing.state!=="published"){
  const validated=noticeIds(ids)!;
  const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM plots WHERE project_id=? AND inventory_active=1 AND id IN ("+validated.map(()=>"?").join(",")+")").bind(session.projectId,...validated).first<{count:number}>();
  if(Number(count?.count||0)!==validated.length)return answer({error:"This update references missing/inactive plots; cannot publish"},409);
 }
 const now=new Date().toISOString();
 const updated=await env.DB.prepare(
  "UPDATE project_plot_notices SET state=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END,updated_at=? WHERE project_id=? AND id=? AND state=?"
 ).bind(state,state,now,now,session.projectId,id,existing.state).run();
 if(!updated.meta.changes)return answer({error:"Another admin changed this notice. Refresh to review."},409);
 await writeAudit(session,"project.plot_notice_published",session.projectId,id,{previousState:existing.state,state,eventDate:existing.eventDate,plotIds:ids});
 return answer({ok:true,state});
}
