import {env} from "cloudflare:workers";
import {sameOrigin,validAdminSession} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {METRO_AGREEMENT_FIELD,metroAgreementEnabled} from "@/app/metro-agreement";

const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});

// Only the authenticated Metro City Client Admin can set the standalone agreement flag.
// This endpoint never writes canonical plot status, Deal Progress stages or the Sales Ledger.
export async function PATCH(request:Request){
 if(!sameOrigin(request))return respond({error:"Invalid origin"},403);
 const session=await validAdminSession();
 if(!session||session.role!=="client_admin")return respond({error:"Client Admin login required"},401);
 if(!await metroAgreementEnabled(session.projectId))return respond({error:"Agreement Done is not enabled for this project"},403);
 let input:Record<string,unknown>;
 try{
  const raw=await request.text();if(raw.length>600)throw Error();
  input=JSON.parse(raw);
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error();
 }catch{return respond({error:"Invalid request"},400)}
 const plotId=typeof input.plotId==="string"?input.plotId.trim():"";
 const done=input.agreementDone,rev=input.expectedRevision;
 if(!plotId||plotId.length>80||typeof done!=="boolean"||!Number.isSafeInteger(rev)||Number(rev)<0)
  return respond({error:"Plot, checkbox value and revision are required"},400);
 const active=await env.DB.prepare(
  "SELECT id FROM plots WHERE project_id=? AND id=? AND inventory_active=1"
 ).bind(session.projectId,plotId).first();
 if(!active)return respond({error:"Active project plot not found"},404);
 const previous=await env.DB.prepare(
  "SELECT field_value AS value,revision FROM plot_custom_values WHERE project_id=? AND plot_id=? AND field_key=?"
 ).bind(session.projectId,plotId,METRO_AGREEMENT_FIELD).first<{value:string;revision:number}>();
 const currentRevision=previous?.revision||0;
 if(currentRevision!==rev)return respond({error:"Agreement was changed in another session. Refresh plots before trying again.",currentRevision},409);
 if(previous?.value===(done?"true":"false"))return respond({ok:true,plotId,agreementDone:done,revision:currentRevision});
 const now=new Date().toISOString();
 const result=currentRevision===0
  ?await env.DB.prepare(
    "INSERT INTO plot_custom_values(project_id,plot_id,field_key,field_value,revision,updated_at,updated_by) "+
    "SELECT ?,?,? ,?,1,?,? WHERE EXISTS(SELECT 1 FROM plots WHERE project_id=? AND id=? AND inventory_active=1) "+
    "AND EXISTS(SELECT 1 FROM project_custom_fields WHERE project_id=? AND field_key=? AND field_type='checkbox' AND enabled=1) "+
    "ON CONFLICT(project_id,plot_id,field_key) DO NOTHING RETURNING revision"
   ).bind(session.projectId,plotId,METRO_AGREEMENT_FIELD,done?"true":"false",now,session.id,session.projectId,plotId,session.projectId,METRO_AGREEMENT_FIELD).all<{revision:number}>()
  :await env.DB.prepare(
    "UPDATE plot_custom_values SET field_value=?,revision=revision+1,updated_at=?,updated_by=? "+
    "WHERE project_id=? AND plot_id=? AND field_key=? AND revision=? "+
    "AND EXISTS(SELECT 1 FROM plots WHERE project_id=? AND id=? AND inventory_active=1) "+
    "AND EXISTS(SELECT 1 FROM project_custom_fields WHERE project_id=? AND field_key=? AND field_type='checkbox' AND enabled=1) "+
    "RETURNING revision"
   ).bind(done?"true":"false",now,session.id,session.projectId,plotId,METRO_AGREEMENT_FIELD,rev,session.projectId,plotId,session.projectId,METRO_AGREEMENT_FIELD).all<{revision:number}>();
 if(!result.results.length)return respond({error:"Agreement changed before save. Reload latest data.",currentRevision},409);
 const persisted=await env.DB.prepare(
  "SELECT field_value AS value,revision FROM plot_custom_values WHERE project_id=? AND plot_id=? AND field_key=?"
 ).bind(session.projectId,plotId,METRO_AGREEMENT_FIELD).first<{value:string;revision:number}>();
 if(!persisted||persisted.value!==(done?"true":"false")||persisted.revision!==result.results[0].revision)
  return respond({error:"Agreement save verification failed. Reload plot."},409);
 try{
  await writeAudit(session,"project.metro_agreement_updated",session.projectId,plotId,{before:previous?.value==="true",after:done,revision:persisted.revision});
 }catch{console.error("Metro agreement saved, optional audit was unavailable",{plotId})}
 return respond({ok:true,plotId,agreementDone:done,revision:persisted.revision});
}
