import {requireSuperAdmin} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {env} from "cloudflare:workers";
import {salesCsvExport,salesExportKinds,type SalesExportKind} from "@/app/sales-accounts-export";
export async function GET(request:Request){
 const actor=await requireSuperAdmin();
 if(!actor)return Response.json({error:"Super Admin access required"},{status:403});
 const url=new URL(request.url),projectId=url.searchParams.get("projectId")||"",kind=url.searchParams.get("kind")||"sales";
 if(!salesExportKinds.includes(kind as SalesExportKind))return Response.json({error:"Invalid export kind"},{status:400});
 const p=await env.DB.prepare("SELECT id FROM projects WHERE id=? AND status='active'").bind(projectId).first();
 if(!p)return Response.json({error:"Project unavailable"},{status:404});
 try{
  const csv=await salesCsvExport(projectId,kind as SalesExportKind);
  if(csv.ok){try{await writeAudit(actor,"sales.super_export",projectId,null,{kind});}catch{console.error("Sales super export audit failed");}}
  return csv;
 }catch(error){console.error("Sales admin export failed",error);return Response.json({error:"Export failed"},{status:500});}
}
