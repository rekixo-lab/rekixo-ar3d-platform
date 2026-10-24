import {env} from "cloudflare:workers";
import {clientSalesAccess,salesResponse} from "@/app/sales-accounts-server";

// Private, read-only autosuggest. It never accepts a projectId supplied by the browser.
const inventorySql=`SELECT p.id,p.status,p.sqft,p.sqm,p.sqyd,
 d.owner_name AS ownerName,d.broker_name AS brokerName,d.booking_amount_paise AS bookingAmountPaise,
 pp.pricing_type AS pricingType,pp.unit,pp.rate,pp.fixed_price AS fixedPrice,pp.currency,
 active.id AS activeSaleId
 FROM plots p
 LEFT JOIN plot_admin_details d ON d.project_id=p.project_id AND d.plot_id=p.id
 LEFT JOIN plot_pricing pp ON pp.project_id=p.project_id AND pp.plot_id=p.id
 LEFT JOIN property_sales active ON active.project_id=p.project_id AND active.plot_id=p.id AND active.state='active'
 WHERE p.project_id=? AND p.inventory_active=1`;
const naturalOrder=`ORDER BY
 CASE WHEN p.id GLOB '[0-9]*' AND p.id NOT GLOB '*[^0-9]*' THEN 0
      WHEN UPPER(SUBSTR(p.id,1,1)) GLOB '[A-Z]' AND SUBSTR(p.id,2) GLOB '[0-9]*'
       AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN 1 ELSE 2 END,
 CASE WHEN p.id GLOB '[0-9]*' AND p.id NOT GLOB '*[^0-9]*' THEN CAST(p.id AS INTEGER) END,
 CASE WHEN SUBSTR(p.id,2) GLOB '[0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*'
      THEN SUBSTR(p.id,1,1) COLLATE NOCASE END,
 CASE WHEN SUBSTR(p.id,2) GLOB '[0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*'
      THEN CAST(SUBSTR(p.id,2) AS INTEGER) END,
 p.id COLLATE NOCASE`;

export async function GET(request:Request){
 const access=await clientSalesAccess();if(!access.ok)return access.response;
 const {projectId}=access.context;
 const url=new URL(request.url);
 const kind=url.searchParams.get("kind")||"plots";
 const q=String(url.searchParams.get("q")||"").trim().slice(0,70);
 try{
  if(kind==="buyers"){
   // Buyer identity is deliberately selected, not inferred from matching names.
   const pattern="%"+q.replace(/[%_]/g,"")+"%";
   const rows=await env.DB.prepare(`SELECT id,name,mobile,address FROM sales_customers
    WHERE project_id=? AND (name LIKE ? OR COALESCE(mobile,'') LIKE ?)
    ORDER BY name COLLATE NOCASE,id LIMIT 60`).bind(projectId,pattern,pattern).all();
   return salesResponse({buyers:rows.results});
  }
  if(kind!=="plots")return salesResponse({error:"Unsupported lookup"},400);
  const exact=String(url.searchParams.get("plotId")||"").trim();
  if(exact){
   const plot=await env.DB.prepare(inventorySql+" AND p.id=? LIMIT 1").bind(projectId,exact).first();
   return salesResponse({plot:plot||null});
  }
  const pattern="%"+q.replace(/[%_]/g,"")+"%";
  const result=await env.DB.prepare(inventorySql+" AND p.id LIKE ? "+naturalOrder+" LIMIT 101")
   .bind(projectId,pattern).all();
  return salesResponse({plots:result.results.slice(0,100),hasMore:result.results.length>100});
 }catch(error){console.error("Private sales lookup failed",error);return salesResponse({error:"Could not load plot / buyer choices"},500);}
}
