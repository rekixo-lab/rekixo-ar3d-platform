import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const api=read("app/api/client/metro-status/route.ts");
const data=read("app/api/data/route.ts");
const admin=read("app/admin-dashboard.tsx");
const enabled=read("app/metro-agreement.ts");
const otherSales=read("app/api/client/sales/route.ts");

test("Super Admin and Client Admin both use one Metro four-state transactional route",()=>{
 assert.match(api,/\["client_admin","super_admin"\]\.includes\(session\.role\)/);
 assert.match(api,/session\.role==="super_admin"\s*\?\(typeof body\.projectId==="string"\?body\.projectId\.trim\(\):""\):session\.projectId/);
 assert.match(api,/if\(!projectId\|\|!await metroAgreementEnabled\(projectId\)\)/);
 assert.match(api,/sameOrigin\(request\)/);
 assert.match(api,/env\.DB\.batch\(statements\)/);
 assert.match(admin,/if\(agreementEnabled\)\{/);
 assert.match(admin,/body:JSON\.stringify\(\{projectId,plotId:plot\.id,status/);
 assert.match(admin,/tone=\{agreementEnabled\?toastTone:undefined\}/);
});

test("Legacy three-state Admin API cannot bypass Metro agreement flag from either role",()=>{
 assert.match(data,/const agreementEnabled = await metroAgreementEnabled\(projectId\);/);
 assert.match(data,/if\(body\.type==="plotStatus"&&await metroAgreementEnabled\(projectId\)\)/);
 assert.doesNotMatch(data,/body\.type==="plotStatus"&&session\.role==="client_admin"&&await metroAgreementEnabled/);
 assert.match(data,/METRO_STATUS_UNIFIED_ROUTE_REQUIRED/);
 assert.match(data,/agreementDone:agreementByPlot\.get\(row\.plot\.id\)\?\.done\|\|false/);
 assert.match(enabled,/projectId!==METRO_AGREEMENT_PROJECT_ID/);
 assert.match(enabled,/p\.slug='metro-city-c024a5'/);
 assert.match(enabled,/p\.name='Metro City'/);
 assert.match(enabled,/p\.status='active'/);
});

test("Other projects retain original Sold status and Sale recording",()=>{
 assert.match(admin,/if\(status==="sold"&&plot\.status!=="sold"&&salesAccess/);
 assert.match(data,/if \(body\.type === "plotStatus"\)/);
 assert.match(otherSales,/property_sales/);
 assert.match(api,/existing\.activeSaleId&&desired\.inventoryStatus!=="sold"/);
 assert.doesNotMatch(api,/INSERT INTO property_sales|UPDATE property_sales|DELETE FROM property_sales/);
});
