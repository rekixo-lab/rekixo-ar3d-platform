import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const ui=readFileSync("app/client-plot-management.tsx","utf8");
const css=readFileSync("app/client-plot-management.css","utf8");
const mobile=css.slice(css.indexOf("METRO_COMPACT_STATUS_CARDS_V1"));

test("Metro historical warnings are compact accessible disclosures, not permanent paragraphs",()=>{
  assert.match(ui,/<details className="client-metro-legacy-warning">/);
  assert.match(ui,/<summary><span>Record needs review<\/span>/);
  assert.match(ui,/className="client-metro-review-hint">Details<\/span>/);
  assert.match(ui,/<\/details>/);
  assert.doesNotMatch(ui,/<p className="client-metro-legacy-warning"/);
  assert.match(ui,/plot\.agreementDone===true&&\(plot\.status!=="sold"\|\|plot\.agreementSaleVerified===false\)/);
  assert.match(ui,/Original records are unchanged/);
  assert.doesNotMatch(ui,/<details[^>]+open[ >]/);
  assert.match(mobile,/\.client-metro-legacy-warning\[open\]/);
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
  assert.match(ui,/agreementSaleVerified===false/);
});
