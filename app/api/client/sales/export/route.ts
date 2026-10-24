import {clientSalesAccess,salesResponse,salesAudit} from "@/app/sales-accounts-server";
import {salesCsvExport,salesExportKinds,type SalesExportKind} from "@/app/sales-accounts-export";
export async function GET(request:Request){
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 const kind=new URL(request.url).searchParams.get("kind")||"sales";
 if(!salesExportKinds.includes(kind as SalesExportKind))return salesResponse({error:"Invalid export type"},400);
 try{
  const response=await salesCsvExport(access.context.projectId,kind as SalesExportKind);
  if(response.ok){try{await salesAudit(access.context,"sales.export",kind);}catch{console.error("Sales export audit not saved");}}
  return response;
 }catch(error){console.error("Sales export error",error);return salesResponse({error:"Export failed"},500);}
}
