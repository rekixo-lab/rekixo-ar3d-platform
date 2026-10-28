import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const viewer = readFileSync("public/project/index.html", "utf8");
const metroId = "c024a562-634d-4e49-b647-43209f6e450b";
const fitStart = viewer.indexOf("  function calcFit(){");
const fitEnd = viewer.indexOf("  // REKIXO_TABLET_ROTATED_START_FIT_V1", fitStart);
const helperStart = viewer.indexOf("  function metroFullPlanMobile(){");
const helperEnd = viewer.indexOf("  function normalizeInitialViewMode(", helperStart);
assert.ok(fitStart > 0 && fitEnd > fitStart && helperStart > 0 && helperEnd > helperStart);
const fitRuntime = viewer.slice(helperStart, helperEnd) + viewer.slice(fitStart, fitEnd);

function fitOnMobile(metro, image = { w: 1600, h: 900 }) {
  const env = {
    metroMobileTileSafety: metro,
    window: { matchMedia: () => ({ matches: true }) },
    viewport: { clientWidth: 360, clientHeight: 720 },
    displaySize: () => image,
    fit: 0, minFit: 0, viewportWidth: 0, viewportHeight: 0,
  };
  vm.runInNewContext(fitRuntime, env);
  env.calcFit();
  return { fit: env.fit, minFit: env.minFit };
}

test("Metro handset starts with entire original image visible, not cover-cropped", () => {
  const result = fitOnMobile(true);
  assert.equal(result.fit, 360 / 1600);
  assert.equal(result.minFit, result.fit);
  const other = fitOnMobile(false);
  assert.equal(other.fit, 720 / 900, "other projects retain cover-fit");
  assert.equal(other.minFit, 360 / 1600);
  assert.match(viewer, /metroMobileTileSafety=data.projectId==='c024a562-634d-4e49-b647-43209f6e450b'/);
  assert.ok(viewer.includes(metroId));
  assert.match(viewer, /if\(metroFullPlanMobile\(\)\)\{[\s\S]*?scale=fit;\s*pan=\{x:0,y:0\}/);
});

test("Metro four filters restrict 2D touches, but all other projects keep existing hit semantics", () => {
  const helper = viewer.match(/  function metroFilterAllowsPlot\(p\)\{[^\n]+\}/)?.[0];
  assert.ok(helper);
  const run = (metro, filter, status) => {
    const env = {
      metroAgreementMode: metro, showAll: true, statusFilter: filter,
      matchesStatusFilter: (p, f) => f === p.status || (f === "agreement" && p.agreementDone),
    };
    vm.runInNewContext(helper, env);
    return env.metroFilterAllowsPlot(status);
  };
  assert.equal(run(true, "booked", { status: "available" }), false);
  assert.equal(run(true, "booked", { status: "booked" }), true);
  assert.equal(run(true, "agreement", { status: "sold", agreementDone: true }), true);
  assert.equal(run(true, "agreement", { status: "sold", agreementDone: false }), false);
  assert.equal(run(false, "booked", { status: "available" }), true);
  assert.match(viewer, /const exact=plots.find\(p=>metroFilterAllowsPlot\(p\)&&pointInPolygon/);
  assert.match(viewer, /p.id===el.dataset.plotId&&metroFilterAllowsPlot\(p\)/);
  assert.match(viewer, /if\(!metroFilterAllowsPlot\(p\)\)continue;/);
  assert.match(viewer, /engine3D\?\.setStatusFilter\?\.\(st\)/);
});

test("compact Metro HUD is strictly tenant/mobile scoped with all four rows", () => {
  assert.match(viewer, /@media\(max-width:700px\)\{\s*body\[data-metro-four-status="1"\] \.status\{box-sizing:border-box;width:126px/);
  for (const key of ["available", "booked", "sold", "agreement"]) {
    assert.ok(viewer.includes('data-status-filter="' + key + '"'));
  }
  // Late Metro-specific !important colors must not unhide filtered-out plots.
  for (const [filter, attribute] of [
    ["available", "data-status=\"available\""],
    ["booked", "data-status=\"booked\""],
    ["sold", "data-status=\"sold\""],
    ["agreement", "data-metro-visual=\"agreement\""],
  ]) {
    assert.ok(viewer.includes('body[data-metro-four-status="1"] .show-all.status-filter-' + filter +
      ' .plot:not([' + attribute + '])'), "exclusive filter missing: " + filter);
  }
  assert.match(viewer, /const released=document\.elementFromPoint\(e\.clientX,e\.clientY\)\?\.closest\?\.\('\.status-option'\)/);
  assert.match(viewer, /if\(released&&statusBody\.contains\(released\)\)glassOpt=released/);
  assert.match(viewer, /if\(statusFilter&&\(metroAgreementMode\|\|statusFilter==='agreement'\)\)clearMismatchedSelection/);
});

test("masterplan pixels, normalized polygons, HD native tiles stay canonical", () => {
  assert.match(viewer, /const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
  assert.match(viewer, /world\.style\.transform = `translate3d\(/);
  assert.match(viewer, /svg\.getScreenCTM\?\.\(\)/);
  assert.match(viewer, /const tiles=new Map\(\),tileSize=1536/);
  assert.match(viewer, /const tileStep=safeMobileTiles\?1024:tileSize/);
  assert.match(viewer, /originalParams\.set\('fidelity','original-v2'\)/);
});
