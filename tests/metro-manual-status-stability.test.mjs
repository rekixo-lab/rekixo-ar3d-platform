import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");
const api=read("app/api/client/metro-status/route.ts");
const dashboard=read("app/admin-dashboard.tsx");
const toast=read("app/motion-swap.tsx");
const style=read("app/globals.css");
const publicApi=read("app/api/public-live/route.ts");
const clientPlots=read("app/client-plot-management.tsx");
const otherApi=read("app/api/data/route.ts");

test("Metro four public inventory statuses do not fabricate or demand a financial Sale",()=>{
  assert.match(api,/metroAgreementEnabled\(projectId\)/);
  assert.match(api,/isMetroDisplayStatus\(target\)/);
  assert.match(api,/desired\.inventoryStatus===existing\.status&&desired\.agreementDone===beforeDone/);
  assert.match(api,/env\.DB\.batch\(statements\)/);
  assert.doesNotMatch(api,/AGREEMENT_REQUIRES_SALE|SALE_DETAILS_REQUIRED/);
  assert.doesNotMatch(api,/INSERT INTO property_sales|UPDATE property_sales|DELETE FROM property_sales/);
  assert.match(api,/activeSaleRecorded:Boolean\(existing\.activeSaleId\)/);
  assert.match(api,/previousAgreement:beforeDone,nextAgreement:desired\.agreementDone/);
  assert.match(publicApi,/metroAgreementEnabled\(projectId\)/);
  assert.match(publicApi,/agreementDone:metroAgreementByPlot\.get\(row\.id\)\?\.done\|\|false/);
});

test("An active Sale cannot be erased by changing Metro public inventory to Available or Booked",()=>{
  assert.match(api,/existing\.activeSaleId&&desired\.inventoryStatus!=="sold"/);
  assert.match(api,/ACTIVE_SALE_STATUS_PROTECTED/);
  assert.match(api,/AND \(\?='sold' OR NOT EXISTS\(SELECT 1 FROM property_sales s/);
  assert.match(api,/beforeRevision!==expectedRevision/);
  assert.match(api,/json\('metro-status-conflict'\)/);
  assert.match(api,/saved\.status!==desired\.inventoryStatus/);
  assert.match(api,/writeAudit\(session/);
});

test("Metro Admin status directly saves without forced Sales form, other projects retain original Sale workflow",()=>{
  const start=dashboard.indexOf('if(agreementEnabled){');
  const end=dashboard.indexOf('  if(status==="sold"&&plot.status!=="sold"',start);
  assert.ok(start>=0&&end>start);
  const metro=dashboard.slice(start,end);
  assert.match(metro,/fetch\("\/api\/client\/metro-status"/);
  assert.doesNotMatch(metro,/sales\/assist|setTab\("sales"\)|setGuidedPlotId|salesRole==="viewer"/);
  assert.match(metro,/statusBusy|setStatusBusy/);
  assert.match(metro,/activeSaleRecorded===true/);
  assert.match(metro,/show\(error instanceof Error\?error\.message:"Metro status not saved","error"\)/);
  assert.match(dashboard.slice(end),/\/api\/client\/sales\/assist/);
  assert.match(dashboard.slice(end),/Sales Editor \/ Approver access is required/);
  assert.match(otherApi,/METRO_STATUS_UNIFIED_ROUTE_REQUIRED/);
  assert.match(clientPlots,/<option value="agreement">Agreement Done<\/option>/);
});

test("Metro-only failed save toast is visibly red, success is green, other projects unchanged",()=>{
  assert.match(toast,/tone\?:"success"\|"error"/);
  assert.match(toast,/data-tone=\{tone\}/);
  assert.match(toast,/tone\?\(tone==="error"\?"alert":"status"\):undefined/);
  assert.match(dashboard,/agreementEnabled\?" metro-status-admin":""/);
  assert.match(dashboard,/agreementEnabled\?toastTone:undefined/);
  assert.match(style,/\.admin-shell\.metro-status-admin \.toast-admin\[data-tone="error"\]/);
  assert.match(style,/border:1px solid #e15a6e/);
  assert.match(style,/bottom:calc\(102px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(dashboard,/tone==="error"\?5200:2600/);
});
