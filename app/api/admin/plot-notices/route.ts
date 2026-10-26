import {env} from "cloudflare:workers";
import {requireSuperAdmin,sameOrigin} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {noticeDate,noticeIds,noticeLabel,parseNoticeRows} from "@/app/project-plot-notices";

const answer=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
async function project(id:string){return env.DB.prepare("SELECT id,name FROM projects WHERE id=? AND status='active'").bind(id).first<{id:string;name:string}>()}
async function enabled(id:string){const r=await env.DB.prepare("SELECT enabled FROM project_plot_notice_settings WHERE project_id=?").bind(id).first<{enabled:number}>();return r?.enabled===1}
async function listing(id:string){
 const flag=await enabled(id);
 const rows=await env.DB.prepare("SELECT id,event_date AS eventDate,category,label,plot_ids_json AS plotIdsJson,state,source,created_at AS createdAt,published_at AS publishedAt FROM project_plot_notices WHERE project_id=? ORDER BY event_date DESC,created_at DESC,id DESC LIMIT 250").bind(id).all<Record<string,unknown>>();
 return {projectId:id,enabled:flag,notices:parseNoticeRows(rows.results)};
}
export async function GET(req:Request){
 const actor=await requireSuperAdmin();if(!actor)return answer({error:"Super Admin required"},403);
 const projectId=new URL(req.url).searchParams.get("projectId")||"";
 if(!await project(projectId))return answer({error:"Project not found"},404);
 return answer(await listing(projectId));
}
export async function PATCH(req:Request){
 const actor=await requireSuperAdmin();if(!actor)return answer({error:"Super Admin required"},403);
 if(!sameOrigin(req))return answer({error:"Invalid origin"},403);
 let b:Record<string,unknown>;try{const raw=await req.text();if(raw.length>2500)throw Error();b=JSON.parse(raw);if(!b||typeof b!=="object"||Array.isArray(b))throw Error()}catch{return answer({error:"Invalid request"},400)}
 const projectId=typeof b.projectId==="string"?b.projectId:"";
 if(!await project(projectId))return answer({error:"Project not found"},404);
 const action=String(b.action||""),now=new Date().toISOString();
 if(action==="enable"){
  if(typeof b.enabled!=="boolean")return answer({error:"Expected boolean"},400);
  await env.DB.prepare("INSERT INTO project_plot_notice_settings(project_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at").bind(projectId,b.enabled?1:0,now).run();
  await writeAudit(actor,"project.plot_notice_enabled",projectId,null,{enabled:b.enabled});
 }else if(action==="state"){
  const id=typeof b.id==="string"?b.id:"",state=b.state;
  if(!id||id.length>110||!["draft","published","hidden"].includes(String(state)))return answer({error:"Invalid notice state"},400);
  if(state==="published"&&!await enabled(projectId))return answer({error:"Enable public updates first"},409);
  const found=await env.DB.prepare("SELECT id,category,label,plot_ids_json AS plotIdsJson,event_date AS eventDate FROM project_plot_notices WHERE project_id=? AND id=?").bind(projectId,id).first<Record<string,unknown>>();
  if(!found)return answer({error:"Notice not found"},404);
  const ids=noticeIds(JSON.parse(String(found.plotIdsJson)));
  if(!ids||!noticeDate(found.eventDate)||!noticeLabel(found.label))return answer({error:"Cannot publish malformed notice"},409);
  // Public copy is a dated historical notice, not a live inventory state.
  const changed=await env.DB.prepare("UPDATE project_plot_notices SET state=?,published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,updated_at=? WHERE project_id=? AND id=?").bind(state,state,now,now,projectId,id).run();
  if(!changed.meta.changes)return answer({error:"No change"},409);
  await writeAudit(actor,"project.plot_notice_state",projectId,id,{state,plotIds:ids,eventDate:found.eventDate});
 }else{return answer({error:"Invalid action"},400)}
 return answer({ok:true,...await listing(projectId)});
}
export async function POST(req:Request){
 const actor=await requireSuperAdmin();if(!actor)return answer({error:"Super Admin required"},403);
 if(!sameOrigin(req))return answer({error:"Invalid origin"},403);
 let b:Record<string,unknown>;try{const s=await req.text();if(s.length>4500)throw Error();b=JSON.parse(s);if(!b||typeof b!=="object"||Array.isArray(b))throw Error()}catch{return answer({error:"Invalid request"},400)}
 const projectId=typeof b.projectId==="string"?b.projectId:"",ids=noticeIds(b.plotIds);
 if(!await project(projectId))return answer({error:"Project not found"},404);
 if(!await enabled(projectId))return answer({error:"Enable notifications first"},409);
 if(!ids||!noticeDate(b.eventDate)||!noticeLabel(b.label)||!["inventory","deal"].includes(String(b.category)))return answer({error:"Invalid date, label, category or plot numbers"},400);
 const placeholders=ids.map(()=>"?").join(",");
 const matches=await env.DB.prepare("SELECT id FROM plots WHERE project_id=? AND inventory_active=1 AND id IN ("+placeholders+")").bind(projectId,...ids).all<{id:string}>();
 if(matches.results.length!==ids.length)return answer({error:"One or more plot numbers are not active in this project"},409);
 // Historical announcements always begin in private review, never auto-publish.
 const now=new Date().toISOString(),id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO project_plot_notices(project_id,id,event_date,category,label,plot_ids_json,state,source,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft','manual',?,?,?)").bind(projectId,id,b.eventDate,b.category,String(b.label).trim(),JSON.stringify(ids),actor.id,now,now).run();
 await writeAudit(actor,"project.plot_notice_draft",projectId,id,{eventDate:b.eventDate,plotIds:ids,category:b.category});
 return answer({ok:true,...await listing(projectId)},201);
}
