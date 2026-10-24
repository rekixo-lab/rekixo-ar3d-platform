import {env} from "cloudflare:workers";
import {sameOrigin} from "@/modules/auth";
import {clientSalesAccess,canEdit,canApprove,readSalesBody,salesResponse,salesAudit,salesId} from "@/app/sales-accounts-server";
import {validSalesName,validSaleDate} from "@/app/sales-accounts-core";

/** A correction never deletes an accounting record; every write is project-scoped. */
export async function PATCH(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 const {projectId,role}=access.context;
 if(!canEdit(role))return salesResponse({error:"Editor permission required"},403);
 const body=await readSalesBody(request);
 const id=salesId(body?.saleId),action=body?.action;
 const revision=Number(body?.expectedRevision);
 const reason=typeof body?.reason==="string"?body.reason.trim():"";
 if(!id||!Number.isSafeInteger(revision)||revision<1)
  return salesResponse({error:"Sale ID and current revision required. Refresh and retry."},400);
 try{
  const sale=await env.DB.prepare("SELECT id,customer_id AS customerId,state,revision,plot_id AS plotId FROM property_sales WHERE project_id=? AND id=?")
   .bind(projectId,id).first<{id:string;customerId:string;state:string;revision:number;plotId:string}>();
  if(!sale)return salesResponse({error:"Sale not found"},404);
  if(sale.state!=="active")return salesResponse({error:"This sale is already cancelled"},409);
  if(sale.revision!==revision)return salesResponse({error:"Sale changed in another session. Refresh and retry."},409);
  if(action==="updateBuyer"){
   const name=typeof body?.buyerName==="string"?body.buyerName.trim():"";
   const mobile=typeof body?.buyerMobile==="string"?body.buyerMobile.trim():"";
   const address=typeof body?.buyerAddress==="string"?body.buyerAddress.trim():"";
   if(!validSalesName(name)||!/^\+?[0-9()\-\s]{7,20}$/.test(mobile)||
    mobile.replace(/\D/g,"").length<10||mobile.replace(/\\D/g,"").length>15||
    address.length<8||address.length>600||reason.length<3||reason.length>400)
    return salesResponse({error:"Valid buyer name, mobile, address and correction reason required"},400);
   const shared=await env.DB.prepare("SELECT COUNT(*) AS count FROM property_sales WHERE project_id=? AND customer_id=? AND state='active'")
    .bind(projectId,sale.customerId).first<{count:number}>();
   if((shared?.count||0)>1)return salesResponse({error:"Buyer is linked to multiple active sales. Contact an approver to resolve the shared profile."},409);
   const now=new Date().toISOString();
   // D1 batch is transactional. Revision prevents concurrent edits; checked sale must still be active.
   const res=await env.DB.batch([
    // Update buyer only for the current revision; do not touch it after stale edits.
    env.DB.prepare(`UPDATE sales_customers SET name=?,mobile=?,address=?,updated_at=?
     WHERE project_id=? AND id=? AND EXISTS(
      SELECT 1 FROM property_sales s WHERE s.project_id=? AND s.id=? AND s.customer_id=sales_customers.id
      AND s.state='active' AND s.revision=?
      AND (SELECT COUNT(*) FROM property_sales x WHERE x.project_id=s.project_id
       AND x.customer_id=s.customer_id AND x.state='active')=1)
     RETURNING id`).bind(name,mobile,address,now,projectId,sale.customerId,projectId,id,revision),
    env.DB.prepare(`UPDATE property_sales SET revision=revision+1
     WHERE project_id=? AND id=? AND revision=? AND state='active'
     AND (SELECT COUNT(*) FROM property_sales x WHERE x.project_id=property_sales.project_id
      AND x.customer_id=property_sales.customer_id AND x.state='active')=1
     RETURNING id`).bind(projectId,id,revision)
   ]);
   if(!res[0].results?.length||!res[1].results?.length)throw Error("Buyer correction not applied");
   try{await salesAudit(access.context,"sales.buyer_corrected",id,{reason})}catch{console.error("Buyer correction audit write failed",{id})}
   return salesResponse({ok:true});
  }
  if(action==="updateSaleDate"){
   if(!canApprove(role))return salesResponse({error:"Approver required"},403);
   if(!validSaleDate(body?.saleDate)||reason.length<3||reason.length>400)
    return salesResponse({error:"Valid sale date and reason required"},400);
   const res=await env.DB.prepare(`UPDATE property_sales SET sale_date=?,revision=revision+1
     WHERE project_id=? AND id=? AND revision=? AND state='active'`)
    .bind(body.saleDate,projectId,id,revision).run();
   if(!res.meta.changes)return salesResponse({error:"Sale changed. Refresh."},409);
   try{await salesAudit(access.context,"sales.date_corrected",id,{reason,date:body.saleDate})}catch{console.error("Sale date audit write failed",{id})}
   return salesResponse({ok:true});
  }
  if(action==="voidSale"){
   if(!canApprove(role))return salesResponse({error:"Approver required to cancel a Sale"},403);
   if(reason.length<5||reason.length>400||body?.confirmation!==sale.plotId)
    return salesResponse({error:"Reason and exact Plot ID confirmation required"},400);
   // No bank refund is performed here. Received payments must FIRST be reversed.
   // Net-zero may include reversal events; preserve them for audit.
   const result=await env.DB.prepare(`UPDATE property_sales
    SET state='void',revision=revision+1
    WHERE project_id=? AND id=? AND state='active' AND revision=?
    AND NOT EXISTS(SELECT 1 FROM sales_payments p WHERE p.project_id=property_sales.project_id
      AND p.sale_id=property_sales.id AND p.kind='receipt' AND NOT EXISTS(
       SELECT 1 FROM sales_payments r WHERE r.project_id=p.project_id AND r.sale_id=p.sale_id
       AND r.kind='reversal' AND r.reversed_payment_id=p.id))
    RETURNING id`).bind(projectId,id,revision).first();
   if(!result)return salesResponse({error:"Cancel blocked: reverse all received payments first or refresh the sale."},409);
   try{await salesAudit(access.context,"sales.sale_voided",id,{reason,plotId:sale.plotId})}catch{console.error("Void audit write failed",{id})}
   return salesResponse({ok:true,plotId:sale.plotId,plotStatusUnchanged:true});
  }
  return salesResponse({error:"Unsupported correction"},400);
 }catch(error){console.error("Sales correction failure",error);return salesResponse({error:"Correction failed. Refresh the ledger and retry."},409)}
}
