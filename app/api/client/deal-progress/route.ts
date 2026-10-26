import {env} from "cloudflare:workers";
import {validAdminSession,sameOrigin} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {fieldsOf,stagesOf,validDate,validateCustomValue,type CustomField} from "@/app/project-admin-studio-policy";

const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
async function access(){
  const session=await validAdminSession();
  if(!session||session.role!=="client_admin")return null;
  const project=await env.DB.prepare("SELECT id FROM projects WHERE id=? AND status='active' LIMIT 1").bind(session.projectId).first();
  return project?session:null;
}
async function featureFlags(projectId:string){
  const rows=await env.DB.prepare("SELECT feature_key AS featureKey,enabled FROM project_admin_features WHERE project_id=?").bind(projectId).all<{featureKey:string;enabled:number}>();
  return {dealProgress:rows.results.some(r=>r.featureKey==="deal_progress"&&r.enabled===1),
    customFields:rows.results.some(r=>r.featureKey==="custom_fields"&&r.enabled===1)};
}
async function activePlot(projectId:string,plotId:string){
  return env.DB.prepare("SELECT id,status FROM plots WHERE project_id=? AND id=? AND inventory_active=1 LIMIT 1").bind(projectId,plotId).first<{id:string;status:string}>();
}
export async function GET(request:Request){
  const session=await access();if(!session)return reply({error:"Client Admin access required"},401);
  const projectId=session.projectId,features=await featureFlags(projectId);
  if(new URL(request.url).searchParams.get("featuresOnly")==="1")return reply({features});
  if(!features.dealProgress&&!features.customFields)return reply({enabled:false,features,stages:[],fields:[],plots:[]});
  const url=new URL(request.url),plotId=String(url.searchParams.get("plotId")||"").trim();
  try{
    const [stageRows,fieldRows]=await Promise.all([
      env.DB.prepare("SELECT slug,label,sort_order AS sortOrder,enabled,requires_sale AS requiresSale FROM project_deal_stages WHERE project_id=? ORDER BY sort_order,slug").bind(projectId).all<Record<string,unknown>>(),
      env.DB.prepare("SELECT field_key AS fieldKey,label,field_type AS fieldType,choices_json AS choicesJson,sort_order AS sortOrder,required,enabled FROM project_custom_fields WHERE project_id=? ORDER BY sort_order,field_key").bind(projectId).all<Record<string,unknown>>(),
    ]);
    const stages=features.dealProgress?stagesOf(stageRows.results):[];
    const fields=features.customFields?fieldsOf(fieldRows.results):[];
    if(plotId){
      if(plotId.length>80)return reply({error:"Invalid plot"},400);
      const plot=await activePlot(projectId,plotId);
      if(!plot)return reply({error:"Active plot not found"},404);
      const [state,values,events]=await Promise.all([
        env.DB.prepare("SELECT stage_slug AS stageSlug,hold_until AS holdUntil,note,revision,updated_at AS updatedAt FROM plot_deal_states WHERE project_id=? AND plot_id=?").bind(projectId,plotId).first(),
        env.DB.prepare("SELECT field_key AS fieldKey,field_value AS value,revision FROM plot_custom_values WHERE project_id=? AND plot_id=? ORDER BY field_key").bind(projectId,plotId).all(),
        env.DB.prepare("SELECT previous_stage AS previousStage,next_stage AS nextStage,note,hold_until AS holdUntil,created_at AS createdAt FROM plot_deal_events WHERE project_id=? AND plot_id=? ORDER BY created_at DESC,id DESC LIMIT 25").bind(projectId,plotId).all(),
      ]);
      return reply({enabled:true,features,stages,fields,plot,state:state||{stageSlug:"",holdUntil:null,note:"",revision:0},
        values:values.results,events:events.results});
    }
    const q=String(url.searchParams.get("q")||"").trim().slice(0,70).replace(/[%_]/g,"");
    const offsetValue=Number(url.searchParams.get("offset")||0),offset=Number.isSafeInteger(offsetValue)&&offsetValue>=0?Math.min(offsetValue,2000):0;
    const params=q?[projectId,"%"+q+"%",offset]:[projectId,offset];
    const plotRows=await env.DB.prepare(
      "SELECT p.id,p.status,p.sqft,s.stage_slug AS stageSlug,s.hold_until AS holdUntil,s.revision FROM plots p LEFT JOIN plot_deal_states s ON s.project_id=p.project_id AND s.plot_id=p.id WHERE p.project_id=? AND p.inventory_active=1 "+(q?"AND p.id LIKE ? ":"")+"ORDER BY p.id COLLATE NOCASE LIMIT 50 OFFSET ?"
    ).bind(...params).all();
    return reply({enabled:true,features,stages,fields,plots:plotRows.results,offset,hasMore:plotRows.results.length===50});
  }catch(error){console.error("Deal Progress read failed",error);return reply({error:"Could not load private workflow"},500)}
}
export async function PATCH(request:Request){
  if(!sameOrigin(request))return reply({error:"Invalid origin"},403);
  const session=await access();if(!session)return reply({error:"Client Admin access required"},401);
  const raw=await request.text();if(raw.length>3500)return reply({error:"Request too large"},413);
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error()}catch{return reply({error:"Invalid JSON"},400)}
  const projectId=session.projectId,plotId=typeof body.plotId==="string"?body.plotId.trim():"";
  const revision=body.expectedRevision;
  if(!plotId||plotId.length>80||!Number.isSafeInteger(revision)||Number(revision)<0)
    return reply({error:"Plot and expected revision required"},400);
  const features=await featureFlags(projectId);
  const plot=await activePlot(projectId,plotId);
  if(!plot)return reply({error:"Active plot not found"},404);
  const now=new Date().toISOString();
  try{
    if(body.action==="stage"){
      if(!features.dealProgress)return reply({error:"This project has no Deal Progress module"},403);
      const slug=typeof body.stageSlug==="string"?body.stageSlug:"";
      if(slug&&!/^[a-z][a-z0-9_]{1,47}$/.test(slug))return reply({error:"Invalid stage"},400);
      const note=typeof body.note==="string"?body.note.trim():"";
      if(note.length>600||typeof body.note!=="string")return reply({error:"Note must be under 600 characters"},400);
      const holdUntil=body.holdUntil===null||body.holdUntil===""?null:body.holdUntil;
      if(holdUntil!==null&&!validDate(holdUntil))return reply({error:"Invalid hold date"},400);
      if(slug!=="hold"&&holdUntil!==null)return reply({error:"Hold expiry only applies to Hold stage"},400);
      if(slug){
        const stage=await env.DB.prepare("SELECT enabled,requires_sale AS requiresSale FROM project_deal_stages WHERE project_id=? AND slug=?").bind(projectId,slug).first<{enabled:number;requiresSale:number}>();
        if(!stage||stage.enabled!==1)return reply({error:"Stage not enabled for this project"},409);
        if(stage.requiresSale===1){
          const sale=await env.DB.prepare("SELECT id FROM property_sales WHERE project_id=? AND plot_id=? AND state='active' LIMIT 1").bind(projectId,plotId).first();
          if(plot.status!=="sold"||!sale)return reply({error:"Registered requires an existing active Sale and Sold inventory status"},409);
        }
      }
      const before=await env.DB.prepare("SELECT stage_slug AS stageSlug,revision FROM plot_deal_states WHERE project_id=? AND plot_id=?").bind(projectId,plotId).first<{stageSlug:string|null;revision:number}>();
      if((before?.revision||0)!==revision)return reply({error:"Deal Progress changed in another session. Refresh and retry.",currentRevision:before?.revision||0},409);
      const newRevision=Number(revision)+1;
      // Revision is checked again in D1; no canonical plot status or money is modified.
      const update=revision===0
        ? env.DB.prepare("INSERT INTO plot_deal_states(project_id,plot_id,stage_slug,hold_until,note,revision,updated_at,updated_by) SELECT ?,?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM plots WHERE project_id=? AND id=? AND inventory_active=1) ON CONFLICT(project_id,plot_id) DO NOTHING RETURNING revision")
          .bind(projectId,plotId,slug||null,holdUntil,note,now,session.id,projectId,plotId)
        : env.DB.prepare("UPDATE plot_deal_states SET stage_slug=?,hold_until=?,note=?,revision=revision+1,updated_at=?,updated_by=? WHERE project_id=? AND plot_id=? AND revision=? AND EXISTS(SELECT 1 FROM plots WHERE project_id=? AND id=? AND inventory_active=1) RETURNING revision")
          .bind(slug||null,holdUntil,note,now,session.id,projectId,plotId,revision,projectId,plotId);
      const event=env.DB.prepare("INSERT INTO plot_deal_events(project_id,id,plot_id,previous_stage,next_stage,note,hold_until,actor_id,created_at) SELECT ?,?,?,?,?,?,?,?,? FROM plot_deal_states WHERE project_id=? AND plot_id=? AND revision=? AND COALESCE(stage_slug,'')=? AND updated_by=? AND updated_at=?")
        .bind(projectId,crypto.randomUUID(),plotId,before?.stageSlug||null,slug||null,note,holdUntil,session.id,now,projectId,plotId,newRevision,slug,session.id,now);
      const results=await env.DB.batch([update,event]);
      if(!results[0].results?.length||results[1].meta.changes!==1)return reply({error:"Workflow changed; refresh and retry"},409);
      try{await writeAudit(session,"project.deal_stage_updated",projectId,plotId,{before:before?.stageSlug||null,after:slug||null,holdUntil});}
      catch{console.error("Workflow saved; optional audit log unavailable",{projectId,plotId})}
      return reply({ok:true,revision:newRevision,stageSlug:slug,holdUntil,note});
    }
    if(body.action==="field"){
      if(!features.customFields)return reply({error:"Custom Fields not enabled for this project"},403);
      const fieldKey=typeof body.fieldKey==="string"?body.fieldKey:"";
      if(!/^[a-z][a-z0-9_]{1,47}$/.test(fieldKey))return reply({error:"Invalid field"},400);
      const row=await env.DB.prepare("SELECT field_key AS fieldKey,label,field_type AS fieldType,choices_json AS choicesJson,sort_order AS sortOrder,required,enabled FROM project_custom_fields WHERE project_id=? AND field_key=?").bind(projectId,fieldKey).first<Record<string,unknown>>();
      if(!row||Number(row.enabled)!==1)return reply({error:"Field not enabled"},409);
      const field=fieldsOf([row])[0] as CustomField;
      const value=validateCustomValue(field,body.value);
      if(value===null)return reply({error:"Invalid value for "+field.label},400);
      const newRevision=Number(revision)+1;
      const statement=Number(revision)===0
        ? env.DB.prepare("INSERT INTO plot_custom_values(project_id,plot_id,field_key,field_value,revision,updated_at,updated_by) SELECT ?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM plots WHERE project_id=? AND id=? AND inventory_active=1) AND EXISTS(SELECT 1 FROM project_custom_fields WHERE project_id=? AND field_key=? AND enabled=1) ON CONFLICT(project_id,plot_id,field_key) DO NOTHING RETURNING revision")
          .bind(projectId,plotId,fieldKey,value,now,session.id,projectId,plotId,projectId,fieldKey)
        : env.DB.prepare("UPDATE plot_custom_values SET field_value=?,revision=revision+1,updated_at=?,updated_by=? WHERE project_id=? AND plot_id=? AND field_key=? AND revision=? AND EXISTS(SELECT 1 FROM project_custom_fields WHERE project_id=? AND field_key=? AND enabled=1) RETURNING revision")
          .bind(value,now,session.id,projectId,plotId,fieldKey,revision,projectId,fieldKey);
      const saved=await statement.all();
      if(!saved.results.length)return reply({error:"Field changed in another session. Refresh and retry."},409);
      try{await writeAudit(session,"project.custom_field_updated",projectId,plotId,{fieldKey,revision:newRevision});}
      catch{console.error("Field saved; optional audit log unavailable",{projectId,plotId,fieldKey})}
      return reply({ok:true,fieldKey,value,revision:newRevision});
    }
    return reply({error:"Unsupported action"},400);
  }catch(error){console.error("Deal Progress write failed",error);return reply({error:"Save failed. Refresh and retry."},409)}
}
