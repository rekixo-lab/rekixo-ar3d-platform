import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mapper = await readFile(new URL("../app/plot-mapper.tsx", import.meta.url), "utf8");
const publicHtml = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");

test("Mapping Controls writes explicit per-side display overrides when measurements are edited", () => {
  assert.match(mapper, /syncManualDimensionLabel\(value, previousValue, label, dimensionUnit, existing\?\.dimensionUnit\)/);
  assert.match(mapper, /const anySideEdited = controlsWorkspace && nextLabels\.some/);
  assert.match(mapper, /frontLabel: nextLabels\[0\]/);
  assert.match(mapper, /backLabel: nextLabels\[1\]/);
  assert.match(mapper, /depthLabel: nextLabels\[2\]/);
  assert.match(mapper, /depth2Label:.*nextLabels\[3\]/);
  assert.match(mapper, /sideDimensions: anySideEdited \? null/);
  assert.match(mapper, /frontEdgeIndex: edgeValue/);
  assert.match(mapper, /polygon: JSON\.stringify\(points\)/);
});

test("customer display prioritizes corrected labels over legacy edge measurements", () => {
  for (const [role, edge] of [
    ["front", "front"], ["depth", "depthA"], ["back", "back"], ["depth2", "depthB"],
  ]) {
    const expr = new RegExp("const " + role + "=cleanDimensionLabel\\(p\\." + role + "Label\\)\\|\\|plotEdgeMeasurementValue\\(p,'" + edge + "'");
    assert.match(publicHtml, expr);
  }
});
