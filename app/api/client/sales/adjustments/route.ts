import {env} from "cloudflare:workers";
import {sameOrigin} from "@/modules/auth";
import {clientSalesAccess,canEdit,canApprove,readSalesBody,salesResponse,salesAudit,salesId} from "@/app/sales-accounts-server";
import {parseMoneyPaise,validSaleDate,safeNote} from "@/app/sales-accounts-core";
export async function POST(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 const b=await readSalesBody(request),saleId=salesId(b?.saleId);
 if(!b||!saleId||!canEdit(access.context.role))return salesResponse({error:"Invalid transaction or insufficient access"},403);
 const amount=parseMoneyPaise(b.amount);
 if(amount===null)return salesResponse({error:"Invalid positive amount"},400);
 const projectId=access.context.projectId,userId=access.context.userId,now=new Date().toISOString(),id=crypto.randomUUID(),note=safeNote(b.note);
 try{
  if(b.action==="installment"){
   if(!validSaleDate(b.dueOn))return salesResponse({error:"Valid due date required"},400);
   const result=await env.DB.prepare(`INSERT INTO sales_installments(project_id,id,sale_id,due_on,amount_paise,note,created_by,created_at)
    SELECT s.project_id,?,s.id,?,?,?,?,? FROM property_sales s
    WHERE s.project_id=? AND s.id=? AND s.state='active'`).bind(id,b.dueOn,amount,note||null,userId,now,projectId,saleId).run();
   if(!result.meta.changes)return salesResponse({error:"Active sale not found"},404);
   try{await salesAudit(access.context,"sales.installment_scheduled",saleId,{installmentId:id});}catch{console.error("Installment audit failed",{id});}
   return salesResponse({ok:true,id},201);
  }
  if(b.action==="adjust"){
   if(!canApprove(access.context.role))return salesResponse({error:"Approver permission required"},403);
   if(!["discount","charge"].includes(String(b.kind))||note.length<3)return salesResponse({error:"Adjustment reason and kind required"},400);
   // A discount cannot turn already received money into an unexplained negative balance.
   const kind=String(b.kind);
   const result=await env.DB.prepare(`INSERT INTO sales_adjustments(project_id,id,sale_id,kind,amount_paise,note,created_by,created_at)
    SELECT s.project_id,?,s.id,?,?,?,?,? FROM property_sales s
    WHERE s.project_id=? AND s.id=? AND s.state='active'
    AND ( ?='charge' OR
       s.agreement_paise
       + COALESCE((SELECT SUM(x.amount_paise) FROM sales_adjustments x WHERE x.project_id=s.project_id AND x.sale_id=s.id AND x.kind='charge'),0)
       - COALESCE((SELECT SUM(x.amount_paise) FROM sales_adjustments x WHERE x.project_id=s.project_id AND x.sale_id=s.id AND x.kind='discount'),0)
       - COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END) FROM sales_payments p WHERE p.project_id=s.project_id AND p.sale_id=s.id),0)
       >= ? )`).bind(id,kind,amount,note,userId,now,projectId,saleId,kind,amount).run();
   if(!result.meta.changes)return salesResponse({error:"Adjustment exceeds unpaid balance or sale closed"},409);
   try{await salesAudit(access.context,"sales.adjustment_added",saleId,{adjustmentId:id,kind});}catch{console.error("Adjustment audit failed",{id});}
   return salesResponse({ok:true,id},201);
  }
  return salesResponse({error:"Invalid adjustment action"},400);
 }catch(error){console.error("Sales schedule/adjustment write failed",error);return salesResponse({error:"Could not save transaction"},409);}
}
