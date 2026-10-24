import {env} from "cloudflare:workers";
import {validAdminSession} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
export type SalesRole="viewer"|"editor"|"approver";
export type SalesContext={projectId:string;userId:string;role:SalesRole;email:string;loginId?:string};
export const salesHeaders={"cache-control":"private, no-store"};
export const salesResponse=(data:unknown,status=200)=>Response.json(data,{status,headers:salesHeaders});
export async function clientSalesAccess():Promise<{ok:true;context:SalesContext}|{ok:false;response:Response}>{
 const session=await validAdminSession();
 if(!session||session.role!=="client_admin")return {ok:false,response:salesResponse({error:"Client Admin login required"},401)};
 const projectId=session.projectId;
 const [flag,permission,project]=await Promise.all([
  env.DB.prepare("SELECT value FROM settings WHERE project_id=? AND key='salesAccountsEnabled'").bind(projectId).first<{value:string}>(),
  env.DB.prepare("SELECT level FROM sales_permissions WHERE project_id=? AND user_id=?").bind(projectId,session.id).first<{level:SalesRole}>(),
  env.DB.prepare("SELECT status FROM projects WHERE id=?").bind(projectId).first<{status:string}>()
 ]);
 if(flag?.value!=="1"||project?.status!=="active")return {ok:false,response:salesResponse({error:"Sales & Accounts is not enabled for this project"},403)};
 if(!permission||!["viewer","editor","approver"].includes(permission.level))
  return {ok:false,response:salesResponse({error:"Sales access not granted"},403)};
 return {ok:true,context:{projectId,userId:session.id,role:permission.level,email:session.email,loginId:session.loginId}};
}
export function canEdit(role:SalesRole){return role==="editor"||role==="approver";}
export function canApprove(role:SalesRole){return role==="approver";}
export async function salesAudit(context:SalesContext,action:string,targetId:string,meta:Record<string,unknown>={}){
 await writeAudit({id:context.userId,email:context.email,loginId:context.loginId},action,context.projectId,targetId,meta);
}
export async function readSalesBody(request:Request):Promise<Record<string,unknown>|null>{
 const raw=await request.text();
 if(raw.length>8192)return null;
 try{
  const data=JSON.parse(raw);
  return data&&typeof data==="object"&&!Array.isArray(data)?data:null;
 }catch{return null;}
}
export const salesId=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9_-]{8,64}$/.test(value)?value:null;
