import {env} from "cloudflare:workers";
import {requireSuperAdmin} from "@/modules/auth";

// Secure, read-only project-local export. Does not include money, private buyer
// records, geometry, public snapshots or data from any other project.
export async function GET(request:Request){
  const actor=await requireSuperAdmin();
  if(!actor)return Response.json({error:"Super Admin required"},{status:403});
  const projectId=new URL(request.url).searchParams.get("projectId")||"";
  const project=await env.DB.prepare("SELECT id,name,slug FROM projects WHERE id=? AND status='active'").bind(projectId).first<{id:string;name:string;slug:string}>();
  if(!project)return Response.json({error:"Project not found"},{status:404});
  const tables={
    features:"SELECT * FROM project_admin_features WHERE project_id=? ORDER BY feature_key",
    stages:"SELECT * FROM project_deal_stages WHERE project_id=? ORDER BY sort_order,slug",
    fields:"SELECT * FROM project_custom_fields WHERE project_id=? ORDER BY sort_order,field_key",
    states:"SELECT * FROM plot_deal_states WHERE project_id=? ORDER BY plot_id",
    values:"SELECT * FROM plot_custom_values WHERE project_id=? ORDER BY plot_id,field_key",
    history:"SELECT * FROM plot_deal_events WHERE project_id=? ORDER BY created_at,id"
  } as const;
  const records=await Promise.all(Object.entries(tables).map(async ([key,sql])=>{
    const rows=await env.DB.prepare(sql).bind(projectId).all();
    return [key,rows.results] as const;
  }));
  const result={schemaVersion:1,exportedAt:new Date().toISOString(),project,records:Object.fromEntries(records)};
  return new Response(JSON.stringify(result,null,2),{headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"private, no-store",
    "content-disposition":'attachment; filename="admin-studio-'+project.slug+'.json"'
  }});
}
