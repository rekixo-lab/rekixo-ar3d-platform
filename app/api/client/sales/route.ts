import {env} from "cloudflare:workers";
import {sameOrigin} from "@/modules/auth";
import {recordAutomaticPlotNotice} from "@/app/project-plot-notices";
import {clientSalesAccess,canEdit,readSalesBody,salesResponse,salesAudit,salesId} from "@/app/sales-accounts-server";
import {parseMoneyPaise,validSaleDate,validSalesName,safeNote} from "@/app/sales-accounts-core";

const sums=`(s.agreement_paise
 + COALESCE((SELECT SUM(a.amount_paise) FROM sales_adjustments a WHERE a.project_id=s.project_id AND a.sale_id=s.id AND a.kind='charge'),0)
 - COALESCE((SELECT SUM(a.amount_paise) FROM sales_adjustments a WHERE a.project_id=s.project_id AND a.sale_id=s.id AND a.kind='discount'),0)
 - COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END)
             FROM sales_payments p WHERE p.project_id=s.project_id AND p.sale_id=s.id),0))`;
const projection=`s.id,s.plot_id AS plotId,s.agreement_paise AS agreementPaise,s.sale_date AS saleDate,
 s.state,s.revision,c.name AS buyerName,c.mobile AS buyerMobile,c.address AS buyerAddress,
 s.customer_id AS buyerId, ${sums} AS balancePaise,
 COALESCE((SELECT SUM(CASE WHEN p.kind='receipt' THEN p.amount_paise ELSE -p.amount_paise END)
 FROM sales_payments p WHERE p.project_id=s.project_id AND p.sale_id=s.id),0) AS receivedPaise`;

export async function GET(request:Request){
 const access=await clientSalesAccess();
 if(!access.ok)return access.response;
 const {projectId}=access.context;
 const url=new URL(request.url);
 const saleId=(url.searchParams.get("saleId")||"").trim();
 try{
  if(saleId){
   const sale=await env.DB.prepare(`SELECT ${projection} FROM property_sales s
   JOIN sales_customers c ON c.project_id=s.project_id AND c.id=s.customer_id
   WHERE s.project_id=? AND s.id=? LIMIT 1`).bind(projectId,saleId).first();
   if(!sale)return salesResponse({error:"Sale not found"},404);
   const [payments,adjustments,installments]=await Promise.all([
    env.DB.prepare("SELECT id,kind,amount_paise AS amountPaise,paid_on AS paidOn,payment_method AS method,reference,note,reversed_payment_id AS reversedPaymentId,created_at AS createdAt FROM sales_payments WHERE project_id=? AND sale_id=? ORDER BY created_at,id").bind(projectId,saleId).all(),
    env.DB.prepare("SELECT id,kind,amount_paise AS amountPaise,note,created_at AS createdAt,reverses_adjustment_id AS reversesAdjustmentId FROM sales_adjustments WHERE project_id=? AND sale_id=? ORDER BY created_at,id").bind(projectId,saleId).all(),
    env.DB.prepare("SELECT id,due_on AS dueOn,amount_paise AS amountPaise,note,cancelled_at AS cancelledAt FROM sales_installments WHERE project_id=? AND sale_id=? ORDER BY due_on,id").bind(projectId,saleId).all()
   ]);
   return salesResponse({sale,payments:payments.results,adjustments:adjustments.results,installments:installments.results,role:access.context.role});
  }
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit")||50)||50));
  const offset=Math.min(1000000,Math.max(0,Number(url.searchParams.get("offset")||0)||0));
  const q=String(url.searchParams.get("q")||"").trim().slice(0,60);
  const term="%"+q.replace(/[%_]/g,"")+"%";
  const where=q?"AND (s.plot_id LIKE ? OR c.name LIKE ?)":"";
  const binds=q?[projectId,term,term,limit,offset]:[projectId,limit,offset];
  const rows=await env.DB.prepare(`SELECT ${projection} FROM property_sales s
   JOIN sales_customers c ON c.project_id=s.project_id AND c.id=s.customer_id
   WHERE s.project_id=? ${where} ORDER BY s.sale_date DESC,s.id DESC LIMIT ? OFFSET ?`).bind(...binds).all();
  const total=await env.DB.prepare(`SELECT COUNT(*) AS total FROM property_sales s
   JOIN sales_customers c ON c.project_id=s.project_id AND c.id=s.customer_id
   WHERE s.project_id=? ${where}`).bind(...(q?[projectId,term,term]:[projectId])).first<{total:number}>();
  return salesResponse({sales:rows.results,total:total?.total||0,role:access.context.role});
 }catch(error){console.error("Sales read failed",error);return salesResponse({error:"Could not load private sales"},500);}
}
export async function POST(request:Request){
 if(!sameOrigin(request))return salesResponse({error:"Invalid origin"},403);
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 if(!canEdit(access.context.role))return salesResponse({error:"Sales write permission required"},403);
 const body=await readSalesBody(request);
 if(!body||body.action!=="createSale")return salesResponse({error:"Invalid sale request"},400);
 const plotId=typeof body.plotId==="string"?body.plotId.trim():"";
 const buyerName=typeof body.buyerName==="string"?body.buyerName.trim():"";
 const mobile=typeof body.buyerMobile==="string"?body.buyerMobile.trim():"";
 const address=typeof body.buyerAddress==="string"?body.buyerAddress.trim():"";
 const buyerId=body.buyerId===undefined||body.buyerId===null||body.buyerId===""?null:salesId(body.buyerId);
 const saleDate=body.saleDate,amount=parseMoneyPaise(body.agreementAmount);
 const expectedStatus=body.expectedPlotStatus;
 const markSold=body.markSold===true;
 // Optional first received amount is part of the SAME D1 transaction as the
 // agreement, buyer and Sold transition. A missing amount means no payment.
 const firstPaymentRaw=body.firstPaymentAmount;
 const firstPayment=firstPaymentRaw===undefined||firstPaymentRaw===""||firstPaymentRaw==="0"?0:parseMoneyPaise(firstPaymentRaw);
 const firstMode=body.firstPaymentMethod;
 const firstDate=body.firstPaymentDate;
 const firstReference=typeof body.firstPaymentReference==="string"?body.firstPaymentReference.trim():"";
 if(firstPayment===null||firstPayment>Number(amount||0)||firstReference.length>100||
  (firstPayment>0&&(!["upi","bank","cash","cheque","other"].includes(String(firstMode))||!validSaleDate(firstDate))))
  return salesResponse({error:"First payment must be within agreement amount, with valid date/mode"},400);
 if(!plotId||plotId.length>80||!["available","booked","sold"].includes(String(expectedStatus))||
   (body.buyerId && !buyerId)||(!buyerId && !validSalesName(buyerName))||
   !/^\+?[0-9()\-\s]{7,20}$/.test(mobile)||
   (mobile.replace(/\D/g,"").length<10 || mobile.replace(/\D/g,"").length>15)||
   address.length<8||address.length>600||!validSaleDate(saleDate)||amount===null||typeof body.markSold!=="boolean")
   return salesResponse({error:"Invalid plot, buyer, date, amount or status selection"},400);
 // A newly confirmed sale must be reflected in plot inventory. A plot already
 // marked Sold (including historical records) stays Sold without changing data.
 if(expectedStatus!=="sold"&&!markSold)
  return salesResponse({error:"Confirm Mark Sold when recording a new Sale."},400);
 const {projectId,userId}=access.context;
 try{
  const plot=await env.DB.prepare("SELECT status FROM plots WHERE project_id=? AND id=? AND inventory_active=1")
   .bind(projectId,plotId).first<{status:string}>();
  if(!plot)return salesResponse({error:"Active plot not found"},404);
  if(plot.status!==expectedStatus)
   return salesResponse({error:"Plot status changed. Refresh plot selection before saving."},409);
  let existingBuyer:{name:string;mobile:string|null;address:string|null}|null=null;
  if(buyerId){
   existingBuyer=await env.DB.prepare("SELECT name,mobile,address FROM sales_customers WHERE project_id=? AND id=?")
    .bind(projectId,buyerId).first<{name:string;mobile:string|null;address:string|null}>();
   if(!existingBuyer)return salesResponse({error:"Selected buyer is no longer available in this project"},409);
   // Reused buyer details are never silently overwritten.
   if((existingBuyer.mobile?.trim() && existingBuyer.mobile.trim()!==mobile)||
      (existingBuyer.address?.trim() && existingBuyer.address.trim()!==address))
      return salesResponse({error:"Saved buyer contact details differ. Refresh or select a new buyer."},409);
  }
  const saleId=crypto.randomUUID(),resolvedBuyerId=buyerId||crypto.randomUUID(),now=new Date().toISOString();
  const mutations=[];
  if(!buyerId){
   mutations.push(env.DB.prepare("INSERT INTO sales_customers(project_id,id,name,mobile,address,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(projectId,resolvedBuyerId,buyerName,mobile||null,address||null,userId,now,now));
  }
  if(buyerId && existingBuyer && (!existingBuyer.mobile?.trim()||!existingBuyer.address?.trim())){
   // Complete previously missing fields only; preserve all existing contact info.
   mutations.push(env.DB.prepare(`UPDATE sales_customers
    SET mobile=CASE WHEN mobile IS NULL OR TRIM(mobile)='' THEN ? ELSE mobile END,
        address=CASE WHEN address IS NULL OR TRIM(address)='' THEN ? ELSE address END,
        updated_at=?
    WHERE project_id=? AND id=?`).bind(mobile,address,now,projectId,buyerId));
  }
  // D1.batch is transactional. Insert first, requiring the EXACT earlier plot
  // status inside the same transaction; a mismatch inserts agreement=0, which
  // violates the positive-amount CHECK and rolls back the entire buyer + sale
  // batch. No orphan buyer or unintended status change can survive a conflict.
  const saleMutationIndex=mutations.length;
  mutations.push(env.DB.prepare(`INSERT INTO property_sales
   (project_id,id,plot_id,customer_id,agreement_paise,sale_date,state,created_by,created_at)
   VALUES(?,?,?,?,CASE WHEN EXISTS(
     SELECT 1 FROM plots p WHERE p.project_id=? AND p.id=? AND p.inventory_active=1 AND p.status=?
   ) THEN ? ELSE 0 END,?,'active',?,?) RETURNING id`)
   .bind(projectId,saleId,plotId,resolvedBuyerId,projectId,plotId,expectedStatus,amount,saleDate,userId,now));
  if(markSold && plot.status!=="sold"){
   mutations.push(env.DB.prepare(`UPDATE plots SET status='sold',updated_at=?
      WHERE project_id=? AND id=? AND inventory_active=1 AND status=?`)
    .bind(now,projectId,plotId,expectedStatus));
  }
  if(firstPayment>0){
   // FK to newly created Sale + a balance check: a failed insert rolls the
   // entire transaction back, rather than leaving a Sale with missing money.
   mutations.push(env.DB.prepare(`INSERT INTO sales_payments
     (project_id,id,sale_id,kind,amount_paise,paid_on,payment_method,reference,note,reversed_payment_id,idempotency_key,created_by,created_at)
     SELECT s.project_id,?,s.id,'receipt',?,?,?,?,NULL,NULL,?,?,?
     FROM property_sales s WHERE s.project_id=? AND s.id=? AND s.state='active'
     AND s.agreement_paise>=?`)
    .bind(crypto.randomUUID(),firstPayment,firstDate,firstMode,firstReference||null,crypto.randomUUID(),userId,now,projectId,saleId,firstPayment));
  }
  const results=await env.DB.batch(mutations);
  if(!results[saleMutationIndex]?.results?.length)throw Error("Sale could not be persisted");
  if(markSold && plot.status!=="sold")await recordAutomaticPlotNotice(projectId,plotId,"inventory",projectId==="c024a562-634d-4e49-b647-43209f6e450b"?"Registered":"Sold","sale:"+saleId,userId,now);
   try{await salesAudit(access.context,"sales.sale_created",saleId,{plotId,markSold,previousStatus:plot.status});}
  catch{console.error("Sale saved, separate audit write failed",{projectId,saleId});}
  return salesResponse({ok:true,saleId,buyerId:resolvedBuyerId,firstPaymentRecorded:firstPayment>0,plotStatus:markSold?"sold":plot.status},201);
 }catch(error){
  console.error("Sale create failure",error);
  return salesResponse({error:"Sale not created. Plot status, duplicate sale or customer selection changed. Refresh and retry."},409);
 }
}
