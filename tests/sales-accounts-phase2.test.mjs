import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const server=read("../app/sales-accounts-server.ts"),route=read("../app/api/client/sales/route.ts");
const admin=read("../app/admin-dashboard.tsx"),ui=read("../app/client-sales-accounts.tsx");
test("Phase 2 sale create strictly derives projectId from client session",()=>{
 assert.match(server,/session\.role!=="client_admin"/);
 assert.match(server,/const projectId=session\.projectId/);
 assert.match(server,/salesAccountsEnabled/);
 assert.match(server,/sales_permissions WHERE project_id=\? AND user_id=\?/);
 assert.match(route,/sameOrigin\(request\)/);
 assert.match(route,/canEdit\(access\.context\.role\)/);
 assert.match(route,/const \{projectId,userId\}=access\.context/);
 assert.match(route,/env\.DB\.batch\(mutations\)/);
 assert.match(route,/inventory_active=1/);
 assert.match(route,/saleId,buyerId:resolvedBuyerId/);
});
test("Phase 2 UI is gated and private buyer data cannot enter public payload",()=>{
 assert.match(admin,/salesAccess\?\[/);
 assert.match(admin,/tab==="sales"&&salesAccess&&<ClientSalesAccounts initialPlotId=/);
 assert.match(ui,/\/api\/client\/sales\?/);
 assert.match(ui,/<SalesSmartEntry onDirty=/);
 assert.match(read("../app/sales-smart-entry.tsx"),/action:"createSale"/);
 assert.doesNotMatch(read("../app/api/public-data/route.ts"),/sales_customers|property_sales|sales_payments/);
});
