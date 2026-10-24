import {env} from "cloudflare:workers";
export const salesExportKinds=["sales","payments","installments","adjustments"] as const;
export type SalesExportKind=(typeof salesExportKinds)[number];
function csvCell(value:unknown){
 const raw=String(value??"").replace(/[\r\n\t]+/g," ").slice(0,1500);
 // Prevent Excel formula execution on buyer names, addresses and arbitrary notes.
 const safe=/^[=+@\-]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
}
const queries:Record<SalesExportKind,string>={
 sales:`SELECT s.id AS SaleId,s.plot_id AS PlotId,c.name AS Buyer,
 c.mobile AS Mobile,c.address AS Address,s.sale_date AS SaleDate,
 s.agreement_paise AS AgreementPaise,s.state AS State
 FROM property_sales s JOIN sales_customers c ON c.project_id=s.project_id AND c.id=s.customer_id
 WHERE s.project_id=? ORDER BY s.sale_date,s.id LIMIT 5001`,
 payments:`SELECT p.id AS PaymentId,p.sale_id AS SaleId,s.plot_id AS PlotId,
 p.kind AS Kind,p.amount_paise AS AmountPaise,p.paid_on AS PaymentDate,
 p.payment_method AS Method,p.reference AS Reference,p.note AS Note,p.reversed_payment_id AS Reverses
 FROM sales_payments p JOIN property_sales s ON s.project_id=p.project_id AND s.id=p.sale_id
 WHERE p.project_id=? ORDER BY p.paid_on,p.id LIMIT 5001`,
 installments:`SELECT i.id AS InstallmentId,i.sale_id AS SaleId,s.plot_id AS PlotId,
 i.due_on AS DueDate,i.amount_paise AS AmountPaise,i.note AS Note
 FROM sales_installments i JOIN property_sales s ON s.project_id=i.project_id AND s.id=i.sale_id
 WHERE i.project_id=? ORDER BY i.due_on,i.id LIMIT 5001`,
 adjustments:`SELECT a.id AS AdjustmentId,a.sale_id AS SaleId,s.plot_id AS PlotId,a.kind AS Kind,
 a.amount_paise AS AmountPaise,a.note AS Note,a.created_at AS CreatedAt
 FROM sales_adjustments a JOIN property_sales s ON s.project_id=a.project_id AND s.id=a.sale_id
 WHERE a.project_id=? ORDER BY a.created_at,a.id LIMIT 5001`
};
const columns:Record<SalesExportKind,string[]>={
 sales:["SaleId","PlotId","Buyer","Mobile","Address","SaleDate","AgreementPaise","State"],
 payments:["PaymentId","SaleId","PlotId","Kind","AmountPaise","PaymentDate","Method","Reference","Note","Reverses"],
 installments:["InstallmentId","SaleId","PlotId","DueDate","AmountPaise","Note"],
 adjustments:["AdjustmentId","SaleId","PlotId","Kind","AmountPaise","Note","CreatedAt"]
};
export async function salesCsvExport(projectId:string,kind:SalesExportKind){
 const result=await env.DB.prepare(queries[kind]).bind(projectId).all<Record<string,unknown>>();
 if(result.results.length>5000)return new Response("Export exceeds 5000 rows; request a smaller audited batch",{status:413,headers:{"cache-control":"private, no-store"}});
 const keys=columns[kind];
 const rows=[keys.join(","),...result.results.map(row=>keys.map(k=>csvCell(row[k])).join(","))];
 return new Response("\uFEFF"+rows.join("\r\n")+"\r\n",{
  headers:{"content-type":"text/csv; charset=utf-8",
    "content-disposition":`attachment; filename="sales-${kind}.csv"`,
    "cache-control":"private, no-store","x-content-type-options":"nosniff"}});
}
