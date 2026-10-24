import {env} from "cloudflare:workers";
import {requireSuperAdmin,sameOrigin} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
const headers={"cache-control":"private, no-store"};
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers});
async function projectExists(id:string){
 const p=await env.DB.prepare("SELECT id FROM projects WHERE id=? AND status='active' LIMIT 1").bind(id).first();
 return Boolean(p);
}
export async function GET(request:Request){
 const actor=await requireSuperAdmin();if(!actor)return respond({error:"Super Admin required"},403);
 const projectId=new URL(request.url).searchParams.get("projectId")||"";
 if(!projectId||!await projectExists(projectId))return respond({error:"Active project not found"},404);
 const [settings,users,stats]=await Promise.all([
  env.DB.prepare("SELECT value FROM settings WHERE project_id=? AND key='salesAccountsEnabled'").bind(projectId).first<{value:string}>(),
  env.DB.prepare(`SELECT u.id,u.name,u.status,sp.level
   FROM admin_users u LEFT JOIN sales_permissions sp ON sp.project_id=u.project_id AND sp.user_id=u.id
   WHERE u.project_id=? AND u.role='client_admin' ORDER BY u.name LIMIT 250`).bind(projectId).all(),
  env.DB.prepare("SELECT COUNT(*) AS total FROM property_sales WHERE project_id=?").bind(projectId).first<{total:number}>()
 ]);
 return respond({projectId,enabled:settings?.value==="1",users:users.results,salesCount:stats?.total||0});
}
export async function PATCH(request:Request){
 const actor=await requireSuperAdmin();if(!actor)return respond({error:"Super Admin required"},403);
 if(!sameOrigin(request))return respond({error:"Invalid origin"},403);
 let data:Record<string,unknown>;
 try{const raw=await request.text();if(raw.length>2048)return respond({error:"Request too large"},413);data=JSON.parse(raw);}
 catch{return respond({error:"Invalid JSON"},400)}
 const projectId=typeof data.projectId==="string"?data.projectId:"";
 if(!projectId||!await projectExists(projectId))return respond({error:"Active project not found"},404);
 const now=new Date().toISOString();
 try{
  if(data.action==="toggle"){
   if(typeof data.enabled!=="boolean")return respond({error:"Enabled flag required"},400);
   await env.DB.prepare(`INSERT INTO settings(project_id,key,value,updated_at) VALUES(?,'salesAccountsEnabled',?,?)
    ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .bind(projectId,data.enabled?"1":"0",now).run();
   await writeAudit(actor,"sales.feature_toggled",projectId,null,{enabled:data.enabled});
   return respond({ok:true,enabled:data.enabled});
  }
  if(data.action==="grant"||data.action==="revoke"){
   const userId=typeof data.userId==="string"?data.userId:"";
   const level=typeof data.level==="string"?data.level:"";
   if(!userId||(data.action==="grant"&&!["viewer","editor","approver"].includes(level)))
    return respond({error:"Invalid user or permission"},400);
   const admin=await env.DB.prepare("SELECT id FROM admin_users WHERE id=? AND project_id=? AND role='client_admin' AND status='active' LIMIT 1")
    .bind(userId,projectId).first();
   if(!admin)return respond({error:"Active client admin must belong to this project"},404);
   if(data.action==="revoke"){
    await env.DB.prepare("DELETE FROM sales_permissions WHERE project_id=? AND user_id=?").bind(projectId,userId).run();
   }else{
    await env.DB.prepare(`INSERT INTO sales_permissions(project_id,user_id,level,granted_by,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(project_id,user_id) DO UPDATE SET level=excluded.level,granted_by=excluded.granted_by,updated_at=excluded.updated_at`)
      .bind(projectId,userId,level,actor.id,now).run();
   }
   await writeAudit(actor,"sales.access_changed",projectId,userId,{action:data.action,level:data.action==="grant"?level:null});
   return respond({ok:true});
  }
  return respond({error:"Invalid action"},400);
 }catch(error){console.error("Sales control update failed",error);return respond({error:"Sales settings not saved"},500);}
}
