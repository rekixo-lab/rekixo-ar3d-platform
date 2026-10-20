import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mapper = await readFile(new URL("../app/plot-mapper.tsx", import.meta.url), "utf8");
const component = await readFile(new URL("../app/project-start-view.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/admin/project-start-view/route.ts", import.meta.url), "utf8");
const publicApi = await readFile(new URL("../app/api/public-data/route.ts", import.meta.url), "utf8");
const publicPage = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");

test("start-view admin state is project-scoped settings only", () => {
  assert.match(api, /publicInitialViewMode/);
  assert.match(api, /publicInitialFocusX/);
  assert.match(api, /publicInitialFocusY/);
  assert.match(api, /requireSuperAdmin\(\)/);
  assert.match(api, /sameOrigin\(request\)/);
  assert.match(api, /project\.start_view_updated/);
  assert.match(api, /INSERT INTO settings \(project_id,key,value,updated_at\)/);
  assert.doesNotMatch(api, /UPDATE plots|DELETE FROM plots|INSERT INTO plots/);
});

test("legacy mode deletes only start-view settings and is the default", () => {
  assert.match(api, /const mode = MODES\.has\(raw\[MODE_KEY\]\) \? raw\[MODE_KEY\] : "legacy"/);
  assert.match(api, /if \(mode === "legacy"\)/);
  assert.match(api, /DELETE FROM settings WHERE project_id=\? AND key IN \(\?,\?,\?\)/);
});

test("mapper UI offers legacy, mapped-plots center and custom focus", () => {
  assert.match(mapper, /import ProjectStartView from "\.\/project-start-view";/);
  assert.match(mapper, /<ProjectStartView/);
  assert.match(mapper, /plots=\{plots\}/);
  assert.match(mapper, /masterplanUrl=\{imageUrl\}/);
  assert.match(component, /Existing \/ Auto/);
  assert.match(component, /Center mapped plots/);
  assert.match(component, /Custom focus point/);
  assert.match(component, /Use mapped plots center as custom point/);
});

test("start-view component reads polygon JSON but never mutates or saves polygons", () => {
  assert.match(component, /JSON\.parse\(plot\.polygon \|\| "\[\]"\)/);
  assert.doesNotMatch(component, /polygon\s*:/);
  assert.doesNotMatch(component, /savePlots|\/api\/plots|\/api\/admin\/mapper/);
});

test("public API exposes only the three project start-view settings", () => {
  assert.match(publicApi, /"publicInitialViewMode"/);
  assert.match(publicApi, /"publicInitialFocusX"/);
  assert.match(publicApi, /"publicInitialFocusY"/);
});

test("public renderer preserves legacy opening behavior exactly when no setting exists", () => {
  assert.match(publicPage, /let publicInitialViewMode='legacy'/);
  assert.match(publicPage, /function normalizeInitialViewMode\(value\)/);
  assert.match(publicPage, /publicInitialViewMode=normalizeInitialViewMode\(s\.publicInitialViewMode\)/);
  assert.doesNotMatch(publicPage, /publicInitialViewMode=normalizeInitialViewMode\(s\);/);
  assert.match(publicPage, /if\(publicInitialViewMode==='custom'\)/);
  assert.match(publicPage, /if\(publicInitialViewMode==='plots'\)/);
  assert.match(publicPage, /if\(!isMobilePanorama\(\)\)return\{x:0,y:0\};/);
  assert.match(publicPage, /return\{x:l\.x,y:0\}/);
});

test("custom and mapped focus are normalized and rotation-aware", () => {
  assert.match(publicPage, /function panForStartFocus\(x,y\)/);
  assert.match(publicPage, /function configuredFocusScale\(focus\)/);
  assert.match(publicPage, /return Math\.max\(fit,Math\.min\(fit\*4\.5,required\*1\.01\)\)/);
  assert.match(publicPage, /const r=rotateOffset\(dx,dy,publicRotation\)/);
  assert.match(publicPage, /return\{x:-r\.x\*scale,y:-r\.y\*scale\}/);
  assert.match(publicPage, /function mappedPlotsCenterFocus\(\)/);
  assert.match(publicPage, /x:\(\(minX\+maxX\)\/2\)\/Math\.max\(1,W\)/);
  assert.match(publicPage, /y:\(\(minY\+maxY\)\/2\)\/Math\.max\(1,H\)/);
});

test("RST keeps using reset so configured start view is restored", () => {
  assert.match(publicPage, /q\('#resetBtn'\)\.onclick=\(\)=>mode3D\?engine3D\?\.reset\(\):reset\(\)/);
  assert.match(publicPage, /function reset\(\)\{/);
  assert.match(publicPage, /scale=focus\?configuredFocusScale\(focus\):fit/);
  assert.match(publicPage, /pan=initialPanForPresentation\(\)/);
});

test("3D renderer stays independent from website start-view presentation", () => {
  assert.doesNotMatch(three, /publicInitialViewMode|publicInitialFocusX|publicInitialFocusY|mappedPlotsCenterFocus/);
});

test("saving Start View explains publishing is required without changing plot geometry", () => {
  assert.match(component, /Review &amp; Publish/);
  assert.match(component, /Publish Update/);
  assert.doesNotMatch(component, /\bUPDATE plots\b|\bDELETE FROM plots\b/);
});
