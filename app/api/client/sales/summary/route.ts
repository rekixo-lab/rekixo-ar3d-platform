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
  // Inventory reporting comes from ALL currently active plots, independent of
  // whether a finance Sale has been recorded. No amount/booking backfill.
  const inventoryRows=await env.DB.prepare(`SELECT
    CASE WHEN status='booked' THEN 'booked' WHEN status='sold' THEN 'sold' ELSE 'available' END AS status,
    COUNT(*) AS plotCount,
    COALESCE(SUM(CASE WHEN sqft IS NOT NULL AND sqft>=0 THEN sqft ELSE 0 END),0) AS areaSqft,
    SUM(CASE WHEN sqft IS NULL OR sqft<0 THEN 1 ELSE 0 END) AS missingAreaCount
    FROM plots WHERE project_id=? AND inventory_active=1
    GROUP BY CASE WHEN status='booked' THEN 'booked' WHEN status='sold' THEN 'sold' ELSE 'available' END`)
    .bind(projectId).all<{status:string;plotCount:number;areaSqft:number;missingAreaCount:number}>();
  const inventory={totalPlots:0,totalAreaSqft:0,missingAreaCount:0,
    available:{plots:0,areaSqft:0},booked:{plots:0,areaSqft:0},sold:{plots:0,areaSqft:0}};
  for(const row of inventoryRows.results){
    const status=row.status==="booked"?"booked":row.status==="sold"?"sold":"available";
    const count=Number(row.plotCount||0),area=Number(row.areaSqft||0);
    inventory[status]={plots:count,areaSqft:area};
    inventory.totalPlots+=count;inventory.totalAreaSqft+=area;
    inventory.missingAreaCount+=Number(row.missingAreaCount||0);
  }
  const total=(agg?.activeAgreementPaise||0)+(agg?.netAdjustmentsPaise||0);
  const received=agg?.receivedPaise||0;
  return salesResponse({stats:{...stats,netSalesPaise:total,receivedPaise:received,outstandingPaise:total-received},inventory,role:access.context.role});
 }catch(error){console.error("Sales report failed",error);return salesResponse({error:"Could not load project accounts"},500);}
}
