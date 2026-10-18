import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => fs.readFileSync(path, "utf8");

test("migration is additive nullable metadata only", () => {
  const sql = read("drizzle/0017_rekixo_exact_dimension_labels.sql");
  assert.match(sql, /ADD COLUMN front_label TEXT/);
  assert.match(sql, /ADD COLUMN depth_label TEXT/);
  assert.match(sql, /ADD COLUMN side_dimensions TEXT/);
  assert.doesNotMatch(sql, /DROP|DELETE FROM|UPDATE plots/i);
});

test("exact labels remain optional for every existing project", () => {
  const sheet = read("app/plot-sheet.ts");
  assert.match(sheet, /frontLabel: string/);
  assert.match(sheet, /depthLabel: string/);
  assert.match(sheet, /sideDimensions: string/);
  assert.match(sheet, /value\(row, indexes\.frontLabel\)/);
});

test("Super Mapper stays project scoped and sheet refresh preserves live state", () => {
  const route = read("app/api/super-mapper/route.ts");
  assert.match(route, /WHERE project_id=\?/);
  assert.match(route, /front_label=COALESCE\(excluded\.front_label,front_label\)/);
  assert.match(route, /depth_label=COALESCE\(excluded\.depth_label,depth_label\)/);
  assert.match(route, /side_dimensions=COALESCE\(excluded\.side_dimensions,side_dimensions\)/);
  const preserve = route.match(/const statement = preserveGeometry[\s\S]*?\? "([^"]+)"/)?.[1] || "";
  assert.doesNotMatch(preserve, /status=excluded\.status/);
  assert.doesNotMatch(preserve, /polygon=excluded\.polygon/);
});

test("legacy numeric formatter stays unchanged and customer labels resolve by evidence priority", () => {
  const html = read("public/project/index.html");
  const oldFormatter =
    "function plotLengthText(value,unit){\n" +
    "    const number=Number(value);\n" +
    "    if(!(number>0))return '';\n" +
    "    const rounded=Math.abs(number-Math.round(number))<.001?String(Math.round(number)):Number(number.toFixed(2)).toString();\n" +
    "    return rounded+' '+(unit==='m'?'m':'ft')\n" +
    "  }";
  assert.ok(html.includes(oldFormatter), "legacy numeric formatter changed");
  assert.match(html, /id="sideDimensionsRow" style="display:none"/);

  // Verify observable behavior, not source-text adjacency: imported segment
  // evidence must remain visible when no manual override is present.
  const begin = html.indexOf("function plotLengthText(value,unit){");
  const end = html.indexOf("function syncFrontDepthFacts(p){", begin);
  assert.ok(begin >= 0 && end > begin, "customer dimension resolver missing");
  const resolver = vm.runInNewContext(
    `(() => { ${html.slice(begin, end)}; return plotSemanticDimensions; })()`,
    {},
  );
  const sourcePlot = {
    points: [[0, 0], [1, 0], [1, 1], [0, 1]],
    front: 20,
    depth: 40,
    dimensionUnit: "ft",
    frontEdgeIndex: 0,
    depthEdgeIndex: 1,
  };
  const legacyNumeric = resolver(sourcePlot);
  assert.equal(legacyNumeric.front, "20 ft");
  assert.equal(legacyNumeric.depth, "40 ft");
  const imported = resolver({
    ...sourcePlot,
    edgeMeasurements: [{ role: "front", segmentIndex: 0, edgeIndex: 0, rawLabel: "19 ft" }],
  });
  assert.equal(imported.front, "19 ft", "retain imported measurement when no manual label exists");
  const edited = resolver({
    ...sourcePlot,
    front: 22,
    frontLabel: "22 ft",
    depthLabel: "41 ft",
    edgeMeasurements: [
      { role: "front", segmentIndex: 0, edgeIndex: 0, rawLabel: "19 ft" },
      { role: "depthA", segmentIndex: 0, edgeIndex: 1, rawLabel: "40 ft" },
    ],
  });
  assert.equal(edited.front, "22 ft", "a verified manual label overrides stale imported evidence");
  assert.equal(edited.depth, "41 ft", "Depth correction cannot be masked by old edge measurements");
});

test("customer Front-left and Depth-bottom presentation remains unchanged", () => {
  const html = read("public/project/index.html");
  assert.match(html, /LEFT side = Front, BOTTOM side = Depth/);
  assert.match(html, /frontEdgeIndex stays mapper metadata only/);
  assert.match(html, /const verticalText='Front'/);
  assert.match(html, /const horizontalText='Depth'/);
});

test("runtime code contains no VISTAR tenant hardcode", () => {
  const runtime = [
    read("public/project/index.html"),
    read("app/api/super-mapper/route.ts"),
    read("app/plot-sheet.ts"),
  ].join("\n").toLowerCase();
  assert.doesNotMatch(runtime, /vatika-green-city-vistar|vatika green city vistar/);
});
