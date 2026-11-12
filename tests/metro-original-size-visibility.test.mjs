import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("METRO Block Mapper fetches source measurements, not a new/empty block size table",()=>{
  const api=read("app/api/admin/metro-blocks/advanced/route.ts");
  assert.match(api,/JOIN plots p ON p\.project_id=m\.project_id AND p\.id=m\.plot_id/);
  for(const field of [
    "p.sqft","p.sqm","p.sqyd","p.dimensions","p.road",
    "p.front","p.back","p.depth","p.depth2",
    "front_label AS frontLabel","back_label AS backLabel",
    "depth_label AS depthLabel","depth2_label AS depth2Label",
    "side_dimensions AS sideDimensions",
  ])assert.ok(api.includes(field),`Original plot reference missing: ${field}`);
  assert.match(api,/return \{\.\.\.source,\.\.\.readBlockSides\(sideBindings\)/);
  assert.doesNotMatch(api,/UPDATE plots|INSERT INTO plots|UPDATE published_plots|INSERT INTO published_plots/i);
});

test("block only: original sizes are visible while selecting/mapping at high zoom, even before Confirm",()=>{
  const mapper=read("app/plot-mapper.tsx");
  const selection=mapper.indexOf('className="mapper-v4-current"');
  const reference=mapper.indexOf('data-testid="metro-block-legacy-measurements"');
  const toolbar=mapper.indexOf('className="mapper-zoombar mapper-v4-toolbar"');
  assert.ok(selection>=0&&reference>selection&&toolbar>reference,"Read-only size strip must be placed next to current plot selection, above zoom toolbar");
  assert.match(mapper,/\{blockMode && \(\s*<section\s+aria-label=\{\`Original measurements for Plot/);
  assert.match(mapper,/blockReferenceArea\(currentPlot\?\.sqft,"sq\.ft"\)/);
  assert.match(mapper,/blockReferenceArea\(currentPlot\?\.sqm,"sq\.m"\)/);
  assert.match(mapper,/blockReferenceArea\(currentPlot\?\.sqyd,"sq\.yd"\)/);
  assert.match(mapper,/currentPlot\?\.dimensions/);
  assert.match(mapper,/currentPlot\?\.road/);
  assert.match(mapper,/blockReferenceSide\(role\)/);
  assert.match(mapper,/Not recorded/);
  assert.match(mapper,/Side lengths come from the original inventory/);
  assert.match(mapper,/\{blockMode && \` · \$\{blockReferenceSide\(role\)\}\`\}/);
});

test("original plot measurements stay editable only in legacy normal mapper, not METRO block drafts",()=>{
  const mapper=read("app/plot-mapper.tsx");
  const api=read("app/api/admin/metro-blocks/advanced/route.ts");
  assert.match(mapper,/fieldset className="mapper-fields guided-fields" disabled=\{blockMode\}/);
  assert.match(mapper,/blockMode\?"\/api\/admin\/metro-blocks\/advanced":"\/api\/super-mapper"/);
  assert.match(api,/UPDATE metro_block_plot_maps SET polygon=\?,side_bindings=\?/);
  assert.match(mapper,/savedPlotRoleMeasurementText\(currentPlot,role,effectiveSideLayout\(\)\)/);
});
