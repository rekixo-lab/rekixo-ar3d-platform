import {env} from "cloudflare:workers";
import {sameOrigin} from "@/modules/auth";
import {clientSalesAccess,canEdit,canApprove,readSalesBody,salesResponse,salesAudit,salesId} from "@/app/sales-accounts-server";
import {parseMoneyPaise,validSaleDate,safeNote} from "@/app/sales-accounts-core";

// The exact balance is evaluated in the INSERT statement; not from a stale browser
// total. SQLite serializes concurrent writers; no read-modify-write lost updates.
const balanceSql=`(s.agreement_paise
 + COALESCE((SELECT SUM(a.amount_paise) FROM sales_adjustments a WHERE a.project_id=s.project_id AND a.sale_id=s.id AND a.kind='charge'),0)
 - COALESCE((SELECT SUM(a.amount_paise) FROM sales_adjustments a WHERE a.project_id=s.project_id AND a.sale_id=s.id AND a.kind='discount'),0)
 - COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END) FROM sales_payments p WHERE p.project_id=s.project_id AND p.sale_id=s.id),0))`;

export async function POST(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid request origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 const {projectId,userId,role}=access.context;
 const b=await readSalesBody(request);
 if(!b||!canEdit(role))return salesResponse({error:"Payments permission required"},403);
 const saleId=salesId(b.saleId);
 if(!saleId)return salesResponse({error:"Invalid sale ID"},400);
 const now=new Date().toISOString(),id=crypto.randomUUID();
 try{
  if(b.action==="receive"){
   const amount=parseMoneyPaise(b.amount),method=b.method,paidOn=b.paidOn;
   const reference=typeof b.reference==="string"?b.reference.trim():"";
   const note=safeNote(b.note);
   const key=salesId(b.idempotencyKey);
   if(amount===null||!key||!validSaleDate(paidOn)||
      !["cash","bank","upi","cheque","other"].includes(String(method))||reference.length>100)
      return salesResponse({error:"Invalid amount, date, method or retry key"},400);
   const existing=await env.DB.prepare("SELECT id,sale_id AS saleId,amount_paise AS amountPaise,kind FROM sales_payments WHERE project_id=? AND idempotency_key=? LIMIT 1")
    .bind(projectId,key).first<{id:string;saleId:string;amountPaise:number;kind:string}>();
   if(existing){
    if(existing.saleId!==saleId||existing.amountPaise!==amount||existing.kind!=="receipt")
     return salesResponse({error:"Retry key reused for a different payment"},409);
    return salesResponse({ok:true,paymentId:existing.id,replayed:true});
   }
   const result=await env.DB.prepare(`INSERT INTO sales_payments(project_id,id,sale_id,kind,amount_paise,paid_on,payment_method,reference,note,reversed_payment_id,idempotency_key,created_by,created_at)
      SELECT s.project_id,?,s.id,'receipt',?,?,?, ?, ?,NULL,?,?,?
      FROM property_sales s WHERE s.project_id=? AND s.id=? AND s.state='active'
       AND ${balanceSql}>=?`)
     .bind(id,amount,paidOn,method,reference||null,note||null,key,userId,now,projectId,saleId,amount).run();
   if(!result.meta.changes)return salesResponse({error:"Payment exceeds outstanding amount or sale is closed"},409);
   try{await salesAudit(access.context,"sales.payment_received",saleId,{paymentId:id});}catch{console.error("Payment saved; audit write failed",{projectId,id});}
   return salesResponse({ok:true,paymentId:id},201);
  }
  if(b.action==="reverse"){
   if(!canApprove(role))return salesResponse({error:"Approval required to reverse payments"},403);
   const originalId=salesId(b.paymentId),reason=typeof b.reason==="string"?b.reason.trim():"";
   const key=salesId(b.idempotencyKey);
   if(!originalId||!key||reason.length<3||reason.length>400)
    return salesResponse({error:"Payment ID, reason and retry key required"},400);
   const result=await env.DB.prepare(`INSERT INTO sales_payments(project_id,id,sale_id,kind,amount_paise,paid_on,payment_method,reference,note,reversed_payment_id,idempotency_key,created_by,created_at)
    SELECT p.project_id,?,p.sale_id,'reversal',p.amount_paise,?,p.payment_method,p.reference,?,p.id,?,?,?
    FROM sales_payments p JOIN property_sales s ON s.project_id=p.project_id AND s.id=p.sale_id
    WHERE p.project_id=? AND p.id=? AND p.sale_id=? AND p.kind='receipt' AND s.state='active'
    AND NOT EXISTS(SELECT 1 FROM sales_payments r WHERE r.project_id=p.project_id AND r.reversed_payment_id=p.id)`)
    .bind(id,now.slice(0,10),reason,key,userId,now,projectId,originalId,saleId).run();
   if(!result.meta.changes)return salesResponse({error:"Receipt already reversed or missing"},409);
   try{await salesAudit(access.context,"sales.payment_reversed",saleId,{reversalId:id,originalId});}catch{console.error("Reversal persisted; audit failed",{id});}
   return salesResponse({ok:true,reversalId:id},201);
  }
  return salesResponse({error:"Unsupported payment action"},400);
 }catch(error){
  // Unique index + retry-key lookup makes uncertain network repeats safe.
  if(b.action==="receive"&&salesId(b.idempotencyKey)){
   const prev=await env.DB.prepare("SELECT id,sale_id AS saleId,amount_paise AS amountPaise,kind FROM sales_payments WHERE project_id=? AND idempotency_key=?")
    .bind(projectId,b.idempotencyKey).first<{id:string;saleId:string;amountPaise:number;kind:string}>();
   if(prev&&prev.saleId===saleId&&prev.kind==="receipt"&&prev.amountPaise===parseMoneyPaise(b.amount))
    return salesResponse({ok:true,paymentId:prev.id,replayed:true});
  }
  console.error("Payment write error",error);
  return salesResponse({error:"Payment could not be saved, please refresh the ledger"},409);
 }
}
