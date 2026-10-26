import {env} from "cloudflare:workers";
import {requireSuperAdmin,sameOrigin} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {ADMIN_FEATURE_KEYS,validKey,validLabel,validChoices,stagesOf,fieldsOf, type FieldType} from "@/app/project-admin-studio-policy";

const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
const enabled=(n:unknown)=>typeof n==="boolean"?n:null;
const integer=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0&&n<=9999?n:null;
async function projectExists(projectId:string){
  return !!await env.DB.prepare("SELECT id FROM projects WHERE id=? AND status='active' LIMIT 1").bind(projectId).first();
}
async function config(projectId:string){
  const [features,stages,fields]=await Promise.all([
    env.DB.prepare("SELECT feature_key AS featureKey,enabled FROM project_admin_features WHERE project_id=?").bind(projectId).all<{featureKey:string;enabled:number}>(),
    env.DB.prepare("SELECT slug,label,sort_order AS sortOrder,enabled,requires_sale AS requiresSale FROM project_deal_stages WHERE project_id=? ORDER BY sort_order,slug").bind(projectId).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT field_key AS fieldKey,label,field_type AS fieldType,choices_json AS choicesJson,sort_order AS sortOrder,required,enabled FROM project_custom_fields WHERE project_id=? ORDER BY sort_order,field_key").bind(projectId).all<Record<string,unknown>>(),
  ]);
  return {projectId,features:Object.fromEntries(ADMIN_FEATURE_KEYS.map(k=>[k,features.results.some(r=>r.featureKey===k&&r.enabled===1)])),
    stages:stagesOf(stages.results),fields:fieldsOf(fields.results)};
}
export async function GET(request:Request){
  const actor=await requireSuperAdmin();
  if(!actor)return response({error:"Super Admin required"},403);
  const projectId=new URL(request.url).searchParams.get("projectId")||"";
  if(!projectId||!await projectExists(projectId))return response({error:"Active project not found"},404);
  return response(await config(projectId));
}
export async function PATCH(request:Request){
  const actor=await requireSuperAdmin();
  if(!actor)return response({error:"Super Admin required"},403);
  if(!sameOrigin(request))return response({error:"Invalid origin"},403);
  const raw=await request.text();
  if(raw.length>6000)return response({error:"Configuration too large"},413);
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=="object")throw Error()}catch{return response({error:"Invalid JSON"},400)}
  const projectId=typeof body.projectId==="string"?body.projectId:"";
  if(!projectId||!await projectExists(projectId))return response({error:"Active project not found"},404);
  const now=new Date().toISOString(),action=String(body.action||"");
  try{
    if(action==="feature"){
      if(!ADMIN_FEATURE_KEYS.includes(body.feature as typeof ADMIN_FEATURE_KEYS[number])||enabled(body.enabled)===null)
        return response({error:"Invalid module"},400);
      const feature=String(body.feature),flag=body.enabled===true;
      await env.DB.prepare("INSERT INTO project_admin_features(project_id,feature_key,enabled,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id,feature_key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at")
        .bind(projectId,feature,flag?1:0,now).run();
      await writeAudit(actor,"project.admin_studio_feature",projectId,feature,{enabled:flag});
    }else if(action==="stage"){
      if(!validKey(body.slug)||!validLabel(body.label)||integer(body.sortOrder)===null||
         enabled(body.enabled)===null||enabled(body.requiresSale)===null)
        return response({error:"Invalid stage configuration"},400);
      const slug=String(body.slug),label=String(body.label).trim();
      const feature=await env.DB.prepare("SELECT enabled FROM project_admin_features WHERE project_id=? AND feature_key='deal_progress'").bind(projectId).first<{enabled:number}>();
      if(feature?.enabled!==1)return response({error:"Enable Deal Progress module first"},409);
      const existing=await env.DB.prepare("SELECT slug FROM project_deal_stages WHERE project_id=? AND slug=?").bind(projectId,slug).first();
      const total=await env.DB.prepare("SELECT COUNT(*) AS total FROM project_deal_stages WHERE project_id=?").bind(projectId).first<{total:number}>();
      if(!existing&&Number(total?.total||0)>=30)return response({error:"Maximum 30 stages"},409);
      await env.DB.prepare("INSERT INTO project_deal_stages(project_id,slug,label,sort_order,enabled,requires_sale,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,slug) DO UPDATE SET label=excluded.label,sort_order=excluded.sort_order,enabled=excluded.enabled,requires_sale=excluded.requires_sale,updated_at=excluded.updated_at")
        .bind(projectId,slug,label,integer(body.sortOrder),body.enabled===true?1:0,body.requiresSale===true?1:0,now).run();
      await writeAudit(actor,"project.admin_studio_stage",projectId,slug,{label,enabled:body.enabled,requiresSale:body.requiresSale});
    }else if(action==="field"){
      if(!validKey(body.fieldKey)||!validLabel(body.label)||!["text","number","date","select","checkbox"].includes(String(body.fieldType))||
          integer(body.sortOrder)===null||enabled(body.enabled)===null||enabled(body.required)===null)
        return response({error:"Invalid field configuration"},400);
      const fieldKey=String(body.fieldKey),fieldType=body.fieldType as FieldType;
      const choices=fieldType==="select"?validChoices(body.choices):[];
      if(!choices||(fieldType==="select"&&choices.length<2))
        return response({error:"Select fields require 2 to 20 unique options"},400);
      const feature=await env.DB.prepare("SELECT enabled FROM project_admin_features WHERE project_id=? AND feature_key='custom_fields'").bind(projectId).first<{enabled:number}>();
      if(feature?.enabled!==1)return response({error:"Enable Custom Fields module first"},409);
      const current=await env.DB.prepare("SELECT field_type AS fieldType,choices_json AS choicesJson FROM project_custom_fields WHERE project_id=? AND field_key=?").bind(projectId,fieldKey).first<{fieldType:string;choicesJson:string}>();
      const total=await env.DB.prepare("SELECT COUNT(*) AS total FROM project_custom_fields WHERE project_id=?").bind(projectId).first<{total:number}>();
      if(!current&&Number(total?.total||0)>=30)return response({error:"Maximum 30 fields"},409);
      if(current&&(current.fieldType!==fieldType||current.choicesJson!==JSON.stringify(choices))){
        const values=await env.DB.prepare("SELECT 1 FROM plot_custom_values WHERE project_id=? AND field_key=? LIMIT 1").bind(projectId,fieldKey).first();
        if(values)return response({error:"Cannot change field type/options after values exist; disable this field and create a new one"},409);
      }
      await env.DB.prepare("INSERT INTO project_custom_fields(project_id,field_key,label,field_type,choices_json,sort_order,required,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,field_key) DO UPDATE SET label=excluded.label,field_type=excluded.field_type,choices_json=excluded.choices_json,sort_order=excluded.sort_order,required=excluded.required,enabled=excluded.enabled,updated_at=excluded.updated_at")
        .bind(projectId,fieldKey,String(body.label).trim(),fieldType,JSON.stringify(choices),integer(body.sortOrder),body.required===true?1:0,body.enabled===true?1:0,now).run();
      await writeAudit(actor,"project.admin_studio_field",projectId,fieldKey,{fieldType,enabled:body.enabled,required:body.required});
    }else{return response({error:"Unsupported action"},400)}
    return response({ok:true,...await config(projectId)});
  }catch(error){
    console.error("Project Admin Studio config failed",error);
    return response({error:"Admin configuration could not be saved"},500);
  }
}
