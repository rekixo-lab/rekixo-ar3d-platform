import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const read=p=>readFileSync(p,"utf8");
test("Metro agreement migration is idempotent, tenant-isolated and preserves original status",()=>{
 const out=execFileSync("python3",["scripts/verify-metro-agreement-migration.py"],{encoding:"utf8"});
 assert.match(out,/PASS: Metro only/);
});
test("Metro-only Sold to Registered display, canonical Booked and Sold IDs and original masterplan intact",()=>{
 const source=read("public/project/index.html");
 assert.match(source,/METRO_AGREEMENT_PRESENTATION_V2/);
 assert.match(source,/metroAgreementMode=data\.metroAgreementEnabled===true/);
 assert.match(source,/metroAgreementMode&&label==='sold'\?'Registered'/);
 assert.match(source,/renderMetroStatusLabels\(\)/);
 assert.match(source,/updateMetroAgreementFact\(p\)/);
 assert.match(source,/updateMetroAgreementFact\(fresh\)/);
 assert.match(source,/row.style.display='none'/);
 assert.match(source,/value.textContent=''/);
 assert.doesNotMatch(source,/Agreement Pending/);
 assert.match(source,/Agreement Done/);
 assert.match(source,/statusDisplayLabel\(st\)/);
 assert.match(source,/data-status-filter="booked"/);
 assert.match(source,/master-original-canvas/);
 assert.doesNotMatch(source,/data-status-filter="registered"/);
});
test("public API returns only Metro agreement boolean, not private values or new plot status",()=>{
 const initial=read("app/api/public-data/route.ts"),live=read("app/api/public-live/route.ts");
 const policy=read("app/metro-agreement.ts");
 assert.match(policy,/c024a562-634d-4e49-b647-43209f6e450b/);
 assert.match(policy,/p\.slug='metro-city-c024a5'/);
 assert.match(policy,/p\.name='Metro City'/);
 assert.match(policy,/f\.field_type='checkbox' AND f\.enabled=1/);
 assert.match(initial,/metroAgreementEnabled:metroPublicAgreement/);
 assert.match(initial,/agreementDone:metroAgreementByPlot\.get\(plot\.id\)\?\.done\|\|false/);
 assert.match(live,/metroAgreementEnabled:metroPublicAgreement/);
 assert.match(live,/agreementDone:metroAgreementByPlot\.get\(row\.id\)\?\.done\|\|false/);
 assert.match(live,/status:row\.status==="booked"\|\|row\.status==="sold"\?row\.status:"available"/);
 assert.doesNotMatch(policy,/owner_name|booking_amount|broker_name|SELECT \*/);
});
test("legacy checkbox API rejects writes and retains Metro-only role gating",()=>{
 const api=read("app/api/client/metro-agreement/route.ts");
 assert.match(api,/validAdminSession\(\)/);
 assert.match(api,/session\.role!=="client_admin"/);
 assert.match(api,/sameOrigin\(request\)/);
 assert.match(api,/metroAgreementEnabled\(session\.projectId\)/);
 assert.match(api,/METRO_AGREEMENT_LEGACY_WRITE_DISABLED/);
 assert.doesNotMatch(api,/UPDATE plots|INSERT INTO plot_custom_values|UPDATE plot_custom_values/);
});

test("Metro Admin has one status selection and dedicated transaction route; no checkbox",()=>{
 const ui=read("app/client-plot-management.tsx");
 const shell=read("app/admin-dashboard.tsx");
 const stages=read("app/api/client/deal-progress/route.ts");
 const dealUi=read("app/client-deal-progress.tsx");
 const status=read("app/api/client/metro-status/route.ts");
 assert.match(ui,/<option value="registered">Registered<\/option>/);
 assert.match(ui,/<option value="agreement">Agreement Done<\/option>/);
 assert.doesNotMatch(ui,/type="checkbox"|toggleAgreement\(/);
 assert.match(shell,/\/api\/client\/metro-status/);
 assert.match(shell,/expectedAgreementRevision:plot\.agreementRevision/);
 assert.match(shell,/savedAgreements/);
 assert.match(status,/env\.DB\.batch\(statements\)/);
 assert.match(status,/ACTIVE_SALE_STATUS_PROTECTED/);
 assert.doesNotMatch(status,/AGREEMENT_REQUIRES_SALE|SALE_DETAILS_REQUIRED/);
 assert.match(stages,/fieldKey===METRO_AGREEMENT_FIELD/);
 assert.match(dealUi,/x\.fieldKey==="agreement_done"/);
 assert.match(stages,/const results=await env\.DB\.batch\(\[update,event\]\)/);
});
