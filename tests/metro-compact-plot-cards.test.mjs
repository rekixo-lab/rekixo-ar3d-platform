import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const ui=readFileSync("app/client-plot-management.tsx","utf8");
const css=readFileSync("app/client-plot-management.css","utf8");
const mobile=css.slice(css.indexOf("METRO_COMPACT_STATUS_CARDS_V1"));

test("Metro plot list has no misleading historical agreement error card",()=>{
  assert.doesNotMatch(ui,/client-metro-legacy-warning|Record needs review|Original records are unchanged/);
  assert.doesNotMatch(css,/client-metro-legacy-warning|client-metro-review-hint/);
  assert.match(ui,/<option value="agreement">Agreement Done<\/option>/);
  assert.match(ui,/onChange=\{\(event\) => onStatusChange\(plot, event\.target\.value\)\}/);
});

test("Metro phone plot cards have a 2-column compact layout with a readable Agreement Done option",()=>{
  assert.match(mobile,/@media \(max-width:600px\)/);
  assert.match(mobile,/\.client-booking-summary\{\s*grid-template-columns:minmax\(0,1fr\) minmax\(132px,144px\)/);
  assert.match(mobile,/\.client-booking-status\{[\s\S]*?height:44px;min-height:44px/);
  assert.match(mobile,/\.client-booking-edit\{[\s\S]*?width:102px;max-width:100%;min-height:44px/);
  assert.match(mobile,/\.client-booking-mobile-meta\{[\s\S]*?grid-area:2 \/ 1/);
  assert.match(css,/\.client-booking-column-head, \.client-booking-summary \{ display: grid/);
  assert.match(ui,/<option value="agreement">Agreement Done<\/option>/);
  assert.match(ui,/onChange=\{\(event\) => onStatusChange\(plot, event\.target\.value\)\}/);
  assert.match(ui,/onClick=\{\(\) => openEditor\(plot\)\}/);
});

test("Compact rules stay Metro Client Admin only; booking fields and legacy status data survive",()=>{
  for(const rule of mobile.match(/\.client-booking-summary\{|\.client-booking-status\{|\.client-booking-edit\{|\.client-booking-mobile-meta\{/g)||[]){
    assert.ok(rule);
  }
  assert.match(mobile,/\.admin-shell\.role-client-admin \.client-booking-list\.metro-four-status/);
  assert.doesNotMatch(mobile,/\.admin-shell\.role-super-admin/);
  assert.match(ui,/onSubmit=\{saveDetails\}/);
  assert.match(ui,/expectedRevision: editor\.baseline\.revision/);
  assert.match(ui,/plot\.status==="sold"\?"registered"/);
  const api=readFileSync("app/api/client/metro-status/route.ts","utf8");
  assert.match(api,/AGREEMENT_REQUIRES_SALE/);
  assert.match(api,/ACTIVE_SALE_STATUS_PROTECTED/);
  assert.match(api,/SALE_DETAILS_REQUIRED/);
  assert.match(api,/env\.DB\.batch\(statements\)/);
});
