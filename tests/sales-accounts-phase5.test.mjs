import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const mapper=read("../app/api/super-mapper/route.ts");
const publish=read("../app/api/admin/publish/route.ts");
const client=read("../app/api/client/sales/export/route.ts");
const admin=read("../app/api/admin/sales-export/route.ts");
const csv=read("../app/sales-accounts-export.ts");
const docs=read("../docs/sales-accounts-rollout.md");
test("Phase 5 financial plot protection applies to CSV preflight, upload and Publish Update",()=>{
 assert.match(mapper,/missingSalesIds: string\[\]/);
 assert.equal(mapper.match(/inventory\.missingSalesIds\.length/g)?.length,2);
 assert.match(mapper,/SALES_LEDGER_PLOT_REMOVAL_BLOCKED/);
 assert.match(publish,/saleProtectedResult/);
 assert.match(publish,/financial records cannot be silently deleted/);
 assert.match(read("../drizzle/0039_project_sales_accounts.sql"),/REFERENCES plots\(project_id,id\) ON DELETE RESTRICT/);
});
test("Phase 5 exports are private, scoped, escaped and disabled on customer API",()=>{
 assert.match(csv,/WHERE s.project_id=\?/);
 assert.match(csv,/WHERE p.project_id=\?/);
 assert.match(csv,/formula execution/);
 assert.match(csv,/LIMIT 5001/);
 assert.match(client,/clientSalesAccess\(\)/);
 assert.match(admin,/requireSuperAdmin\(\)/);
 assert.doesNotMatch(read("../app/api/public-data/route.ts"),/sales_customers|property_sales|sales_payments/);
});
test("Phase 5 pilot has no project auto-enable or fabricated payments",()=>{
 assert.match(docs,/Aravalli Green Farms/);
 assert.match(docs,/defaults to missing\/off/);
 assert.match(docs,/No auto-migration of historic bookings/);
 assert.doesNotMatch(read("../app/sales-accounts-server.ts"),/booking_amount_paise/);
});
