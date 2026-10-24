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


export async function PATCH(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 if(!canEdit(access.context.role))return salesResponse({error:"Editor permission required"},403);
 const b=await readSalesBody(request);
 const saleId=salesId(b?.saleId),id=salesId(b?.entryId);
 const reason=typeof b?.reason==="string"?b.reason.trim():"";
 if(!saleId||!id||reason.length<3||reason.length>300)return salesResponse({error:"Valid entry and correction reason required"},400);
 const {projectId,userId}=access.context,now=new Date().toISOString();
 try{
  if(b?.action==="cancelInstallment"){
   const result=await env.DB.prepare(`UPDATE sales_installments SET cancelled_at=?,cancelled_by=?,cancellation_reason=?
    WHERE project_id=? AND id=? AND sale_id=? AND cancelled_at IS NULL AND EXISTS(
     SELECT 1 FROM property_sales s WHERE s.project_id=sales_installments.project_id
      AND s.id=sales_installments.sale_id AND s.state='active')`)
    .bind(now,userId,reason,projectId,id,saleId).run();
   if(!result.meta.changes)return salesResponse({error:"Installment not found, already cancelled or Sale inactive"},409);
   try{await salesAudit(access.context,"sales.installment_cancelled",saleId,{entryId:id,reason})}catch{console.error("Installment cancellation audit unavailable",{saleId,id})}
   return salesResponse({ok:true});
  }
  if(b?.action==="undoAdjustment"){
   if(!canApprove(access.context.role))return salesResponse({error:"Approver required"},403);
   // Add a compensating opposite entry; preserve the original and prevent
   // duplicate reversal. Never reduce net sale below received money.
   const result=await env.DB.prepare(`INSERT INTO sales_adjustments
    (project_id,id,sale_id,kind,amount_paise,note,created_by,created_at,reverses_adjustment_id)
    SELECT a.project_id,?,a.sale_id,
     CASE WHEN a.kind='charge' THEN 'discount' ELSE 'charge' END,
     a.amount_paise,?, ?,?,a.id
    FROM sales_adjustments a JOIN property_sales s ON s.project_id=a.project_id AND s.id=a.sale_id
    WHERE a.project_id=? AND a.id=? AND a.sale_id=? AND s.state='active'
     AND a.reverses_adjustment_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM sales_adjustments u WHERE u.project_id=a.project_id AND u.reverses_adjustment_id=a.id)
     AND (a.kind='discount' OR (
      s.agreement_paise
      + COALESCE((SELECT SUM(CASE WHEN x.kind='charge' THEN x.amount_paise ELSE -x.amount_paise END)
                  FROM sales_adjustments x WHERE x.project_id=s.project_id AND x.sale_id=s.id),0)
      - COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END)
                  FROM sales_payments p WHERE p.project_id=s.project_id AND p.sale_id=s.id),0)
      >= a.amount_paise))`)
    .bind(crypto.randomUUID(),"Undo adjustment: "+reason,userId,now,projectId,id,saleId).run();
   if(!result.meta.changes)return salesResponse({error:"Adjustment already corrected or insufficient unpaid balance"},409);
   try{await salesAudit(access.context,"sales.adjustment_corrected",saleId,{entryId:id,reason})}catch{console.error("Adjustment correction audit unavailable",{saleId,id})}
   return salesResponse({ok:true});
  }
  return salesResponse({error:"Unsupported correction"},400);
 }catch(error){console.error("Account correction error",error);return salesResponse({error:"Correction failed or already recorded"},409)}
}
