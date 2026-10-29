import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const viewer = readFileSync("public/project/index.html", "utf8");
const metroId = "c024a562-634d-4e49-b647-43209f6e450b";
const fitStart = viewer.indexOf("  function calcFit(){");
const fitEnd = viewer.indexOf("  // REKIXO_TABLET_ROTATED_START_FIT_V1", fitStart);
assert.ok(fitStart > 0 && fitEnd > fitStart);
const fitRuntime = viewer.slice(fitStart, fitEnd);

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

test("Metro first frame and reset retain existing framing; only HD compositing changes", () => {
  const metro=fitOnMobile(true), other=fitOnMobile(false);
  assert.equal(metro.fit, 720 / 900, "Metro first-frame cover-fit is unchanged");
  assert.equal(other.fit, metro.fit, "all other projects retain their framing");
  assert.equal(metro.minFit, 360 / 1600);
  assert.doesNotMatch(viewer, /metroMobileTileSafety/, "global renderer has no Metro-specific image logic");
  assert.match(viewer,/REKIXO_ORIGINAL_ONLY_2D_VIEWPORT_V1/);
  assert.doesNotMatch(viewer, /metroFullPlanMobile/);
  assert.match(viewer, /scale=focus\?configuredFocusScale\(focus\):fit/);
});

test("Metro and other projects use the same original-only 2D renderer",()=>{
  const source=viewer.slice(viewer.indexOf("function prepareOriginalMasterplan("),viewer.indexOf("function displaySize(){"));
  assert.match(source,/canvas\.className='master-original-canvas'/);
  assert.match(source,/master\.style\.visibility='hidden'/);
  assert.match(source,/context\.drawImage\(master,sx,sy,ex-sx,ey-sy,sx,sy,ex-sx,ey-sy\)/);
  assert.match(source,/refreshNativeMasterplan=draw/);
  assert.match(source,/if\(metadata\.original!==true\)\{unavailable\(\);return;\}/);
  assert.doesNotMatch(source,/new Image\(|master-native-tiles|setMetroSourceVisibility/);
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
    ["available", "data-metro-visual=\"available\""],
    ["booked", "data-metro-visual=\"booked\""],
    ["sold", "data-metro-visual=\"registered\""],
    ["agreement", "data-metro-visual=\"agreement\""],
  ]) {
    assert.ok(viewer.includes('body[data-metro-four-status="1"] .show-all.status-filter-' + filter +
      ' .plot:not([' + attribute + '])'), "exclusive filter missing: " + filter);
  }
  assert.match(viewer, /const released=document\.elementFromPoint\(e\.clientX,e\.clientY\)\?\.closest\?\.\('\.status-option'\)/);
  assert.match(viewer, /if\(released&&statusBody\.contains\(released\)\)glassOpt=released/);
  assert.match(viewer, /if\(statusFilter&&\(metroAgreementMode\|\|statusFilter==='agreement'\)\)clearMismatchedSelection/);
});

test("masterplan pixels and normalized polygons remain canonical",()=>{
  assert.match(viewer,/const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
  assert.match(viewer,/world\.style\.transform = `translate3d\(/);
  assert.match(viewer,/svg\.getScreenCTM\?\.\(\)/);
  assert.match(viewer,/REKIXO_ORIGINAL_ONLY_2D_VIEWPORT_V1/);
  assert.match(viewer,/originalParams\.set\('fidelity','original-v2'\)/);
});
