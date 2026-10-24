import {env} from "cloudflare:workers";
import {clientSalesAccess,salesResponse} from "@/app/sales-accounts-server";
// Money is aggregated from canonical private payment events, not booking amounts.
export async function GET(){
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 try{
  const projectId=access.context.projectId;
  const stats=await env.DB.prepare(`SELECT
   COUNT(*) AS saleCount,
   COALESCE(SUM(agreement_paise),0) AS agreementPaise,
   COALESCE(SUM(CASE WHEN state='active' THEN 1 ELSE 0 END),0) AS activeSales
   FROM property_sales WHERE project_id=?`).bind(projectId).first();
  const agg=await env.DB.prepare(`SELECT
    COALESCE((SELECT SUM(CASE WHEN kind='charge' THEN amount_paise ELSE -amount_paise END) FROM sales_adjustments a
      JOIN property_sales s ON s.project_id=a.project_id AND s.id=a.sale_id WHERE s.project_id=? AND s.state='active'),0) AS netAdjustmentsPaise,
    COALESCE((SELECT SUM(CASE WHEN kind='receipt' THEN amount_paise ELSE -amount_paise END) FROM sales_payments p
      JOIN property_sales s ON s.project_id=p.project_id AND s.id=p.sale_id WHERE s.project_id=? AND s.state='active'),0) AS receivedPaise,
    COALESCE((SELECT SUM(agreement_paise) FROM property_sales WHERE project_id=? AND state='active'),0) AS activeAgreementPaise
   `).bind(projectId,projectId,projectId).first<{netAdjustmentsPaise:number;receivedPaise:number;activeAgreementPaise:number}>();
  const total=(agg?.activeAgreementPaise||0)+(agg?.netAdjustmentsPaise||0);
  const received=agg?.receivedPaise||0;
  return salesResponse({stats:{...stats,netSalesPaise:total,receivedPaise:received,outstandingPaise:total-received},role:access.context.role});
 }catch(error){console.error("Sales report failed",error);return salesResponse({error:"Could not load project accounts"},500);}
}
