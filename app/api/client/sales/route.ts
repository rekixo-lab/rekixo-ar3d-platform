import {env} from "cloudflare:workers";
import {sameOrigin} from "@/modules/auth";
import {clientSalesAccess,canEdit,readSalesBody,salesResponse,salesAudit} from "@/app/sales-accounts-server";
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
    env.DB.prepare("SELECT id,kind,amount_paise AS amountPaise,note,created_at AS createdAt FROM sales_adjustments WHERE project_id=? AND sale_id=? ORDER BY created_at,id").bind(projectId,saleId).all(),
    env.DB.prepare("SELECT id,due_on AS dueOn,amount_paise AS amountPaise,note FROM sales_installments WHERE project_id=? AND sale_id=? ORDER BY due_on,id").bind(projectId,saleId).all()
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
 const access=await clientSalesAccess();
 if(!access.ok)return access.response;
 if(!canEdit(access.context.role))return salesResponse({error:"Sales write permission required"},403);
 const body=await readSalesBody(request);
 if(!body||body.action!=="createSale")return salesResponse({error:"Invalid sale request"},400);
 const plotId=typeof body.plotId==="string"?body.plotId.trim():"";
 const buyerName=typeof body.buyerName==="string"?body.buyerName.trim():"";
 const mobile=typeof body.buyerMobile==="string"?body.buyerMobile.trim():"";
 const address=typeof body.buyerAddress==="string"?body.buyerAddress.trim():"";
 const saleDate=body.saleDate;
 const amount=parseMoneyPaise(body.agreementAmount);
 if(!plotId||plotId.length>80||!validSalesName(buyerName)||
    mobile.length>20||(mobile&&!/^\+?[0-9()\-\s]{7,20}$/.test(mobile))||
    address.length>600||!validSaleDate(saleDate)||amount===null)
    return salesResponse({error:"Invalid buyer, plot, date or agreement amount"},400);
 const {projectId,userId}=access.context;
 try{
  const plot=await env.DB.prepare("SELECT status FROM plots WHERE project_id=? AND id=? AND inventory_active=1").bind(projectId,plotId).first<{status:string}>();
  if(!plot)return salesResponse({error:"Active plot not found"},404);
  const saleId=crypto.randomUUID(),buyerId=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO sales_customers(project_id,id,name,mobile,address,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(projectId,buyerId,buyerName,mobile||null,address||null,userId,now,now),
   env.DB.prepare("INSERT INTO property_sales(project_id,id,plot_id,customer_id,agreement_paise,sale_date,state,created_by,created_at) VALUES(?,?,?,?,?,?,'active',?,?)")
    .bind(projectId,saleId,plotId,buyerId,amount,saleDate,userId,now)
  ]);
  await salesAudit(access.context,"sales.sale_created",saleId,{plotId});
  return salesResponse({ok:true,saleId,buyerId},201);
 }catch(error){
  console.error("Sale create failure",error);
  return salesResponse({error:"Sale could not be created; check for an existing active sale on the plot"},409);
 }
}
