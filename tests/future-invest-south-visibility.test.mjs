import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const source = read("app/customer-direction-policy.ts");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(transpiled, { exports });
const { FUTURE_INVEST_REALTY_ID: TARGET, publicSafeText, publicSafeFacing, publicSafeSideSemantics } = exports;
const OTHER = "another-project-id";

test("Future Invest removes South without rewriting another project's values", () => {
  assert.equal(publicSafeText(TARGET, "24 ft South Road"), "");
  assert.equal(publicSafeText(TARGET, "24 ft East Road"), "24 ft East Road");
  assert.equal(publicSafeText(OTHER, "24 ft South Road"), "24 ft South Road");
  assert.equal(publicSafeText(TARGET, "दक्षिण रोड"), "");
  assert.equal(publicSafeText(TARGET, "South-West"), "");
  assert.equal(publicSafeText(TARGET, "SW"), "");
  assert.equal(publicSafeText(TARGET, "SE"), "");
});
test("Mixed facings keep only true non-South bearings and preserve arrows", () => {
  assert.equal(publicSafeFacing(TARGET, "↗ North-East · ↙ South-West · → East"), "↗ North-East · → East");
  assert.equal(publicSafeFacing(TARGET, "↓ South"), "");
  assert.equal(publicSafeFacing(TARGET, "↓ South · ↑ North"), "↑ North");
  assert.equal(publicSafeFacing(OTHER, "↓ South · ↑ North"), "↓ South · ↑ North");
});
test("Public metadata strips stored South overrides without changing original JSON", () => {
  const original = JSON.stringify({
    version: 1, pointCount: 4, roles: { front: [0], back: [2] },
    facingDirectionOverrides: { front: "south", back: "north" },
  });
  const result = JSON.parse(publicSafeSideSemantics(TARGET, original));
  assert.equal(result.facingDirectionOverrides.front, undefined);
  assert.equal(result.facingDirectionOverrides.back, "north");
  assert.equal(JSON.parse(original).facingDirectionOverrides.front, "south");
  assert.equal(publicSafeSideSemantics(OTHER, original), original);
});
test("Public and map surfaces are scoped and do not fall back to unfiltered Road", () => {
  const api = read("app/api/public-data/route.ts");
  const geo = read("app/api/public-geo/handler.ts");
  const html = read("public/project/index.html");
  const mapper = read("app/plot-mapper.tsx");
  const page = read("app/projects/[slug]/page.tsx");
  assert.match(api, /publicSafeFacing\(projectId, facing\)/);
  assert.match(api, /road: publicSafeText\(projectId, publicPlot\.road\)/);
  assert.match(api, /edgeSemantics: publicSafeSideSemantics\(projectId, publicPlot\.edgeSemantics\)/);
  assert.match(geo, /road: publicSafeText\(projectId, plot\?\.road\)/);
  assert.match(html, /function futureInvestSafeFacing\(/);
  assert.match(html, /function syncPublicRoadFact\(/);
  assert.match(html, /compass\.style\.display=futureInvestCompactFacts\(\)\?'none':''/);
  assert.match(mapper, /!isFutureInvestRealty\(projectId\)\|\|item\.direction!==["']south["']/);
  assert.match(page, /project\.id === FUTURE_INVEST_REALTY_ID \? "70" : "69"/);
  assert.match(read("app/api/public-live/route.ts"), /settings\.location=publicSafeText\(projectId,settings\.location\)/);
  assert.match(read("app/project-share-metadata.ts"), /const shareDescription = publicSafeText\(project\.id, settings\.shareDescription\)/);
  assert.match(read("app/api/public-gallery/route.ts"), /caption:publicSafeText\(projectId,item\.caption\)/);
  assert.match(read("app/api/public-plot-notices/route.ts"), /\.filter\(\(notice\)=>Boolean\(publicSafeText\(projectId,notice\.label\)\)\)/);
  assert.match(geo, /hide-south-v1/);
});
