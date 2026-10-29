import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync("public/project/index.html","utf8");
const three=readFileSync("public/project/three-view.js","utf8");
const admin=readFileSync("app/client-plot-management.tsx","utf8");
const shell=readFileSync("app/admin-dashboard.tsx","utf8");
const deals=readFileSync("app/client-deal-progress.tsx","utf8");
const live=readFileSync("app/api/public-live/route.ts","utf8");
const initial=readFileSync("app/api/public-data/route.ts","utf8");

test("fourth status exists only when verified Metro agreement feature is enabled",()=>{
 assert.match(html,/data-status-filter="agreement"[^>]+hidden/);
 assert.match(html,/metroAgreementMode=data\.metroAgreementEnabled===true/);
 assert.match(html,/dataset\.metroFourStatus=metroAgreementMode\?'1':'0'/);
 assert.match(html,/\.hidden=!metroAgreementMode/);
 assert.match(html,/METRO_FOUR_STATUS_V2/);
 assert.match(html,/statusDisplayLabel\(status\)/);
 assert.match(html,/label==='sold'\?'Registered'/);
 assert.match(html,/data-status-filter="booked"/);
 assert.match(initial,/metroAgreementEnabled:metroPublicAgreement/);
 assert.match(live,/metroAgreementEnabled:metroPublicAgreement/);
});

test("Agreement Done is orthogonal to canonical status and cannot change plot inventory",()=>{
 assert.match(html,/function metroVisualStatus\(p\)/);
 assert.match(html,/p\?\.agreementDone===true\?'agreement'/);
 assert.match(html,/function matchesStatusFilter\(p,filter\)/);
 assert.match(html,/filter==='agreement'\?metroAgreementMode&&p\?\.agreementDone===true/);
 assert.match(html,/function plotStatus\(p\)/);
 assert.match(html,/const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
 assert.match(html,/syncMetroPlotVisual\(p,poly\)/);
 assert.match(html,/updateStatusCounts\(\)/);
 assert.match(html,/q\('#countTotal'\)\.textContent=plots\.length/);
 assert.match(html,/q\('#countAgreement'\)\.textContent=agreement/);
 assert.match(html,/value\.textContent=done\?'Agreement Done':''/);
 assert.match(html,/row\.style\.display=done\?'flex':'none'/);
});

test("Metro white yellow green red paint is presentation only, preserving public original masterplan",()=>{
 for(const [status,color] of Object.entries({available:"#fff",booked:"#ffd21a",registered:"#1ed46b",agreement:"#ff3030"})){
  assert.ok(html.includes('data-metro-visual="'+status+'"'),status+" style missing");
  assert.ok(html.includes(color),status+" palette missing");
 }
 assert.match(html,/status-filter-agreement/);
 assert.match(html,/engine3D\.setMetroFourStatus\?\.\(metroAgreementMode\)/);
 assert.match(html,/engine3D\?\.setMetroFourStatus\?\.\(metroAgreementMode\)/);
 assert.match(three,/visualStatusOf\(p\)/);
 assert.match(three,/this\.metroFourStatus\?metroStatusPalette/);
 assert.match(three,/this\.matchesStatusFilter\(p\)/);
 assert.match(three,/hitTest\(x,y\)/);
 assert.match(html,/REKIXO_ORIGINAL_ONLY_2D_VIEWPORT_V1/);
 assert.match(html,/master-original-canvas/);
});

test("Client Admin gets Registered terminology and keeps existing optimistic Agreement checkbox",()=>{
 assert.match(admin,/agreementEnabled\?"Registered":"Sold"/);
 assert.match(admin,/checked=\{plot\.agreementDone===true\}/);
 assert.match(admin,/\/api\/client\/metro-agreement/);
 assert.match(shell,/agreementEnabled\?"Registered":"Sold"/);
 assert.match(shell,/agreementEnabled=\{agreementEnabled\}/);
 assert.ok(deals.includes("x.enabled&&!(metroAgreementEnabled&&"));
 assert.match(deals,/inventoryLabel\(detail\.plot\.status\)/);
});

test("Metro mobile status list accommodates fourth row; other projects stay unchanged",()=>{
 assert.match(html,/body\[data-metro-four-status="1"\] \.status\.expanded \.status-body/);
 assert.match(html,/\[data-status-filter="agreement"\]\[hidden\]\{display:none!important\}/);
 assert.match(html,/q\('\[data-status-filter="agreement"\]'\)\.hidden=!metroAgreementMode/);
});
