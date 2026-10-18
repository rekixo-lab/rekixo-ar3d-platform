import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/mapper-geometry.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { snapPoint } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const savedPlot = [[0.3, 0.5], [0.7, 0.5], [0.7, 0.7], [0.3, 0.7]];

function closePoint(actual, expected) {
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-12, `${actual[0]} !== ${expected[0]}`);
  assert.ok(Math.abs(actual[1] - expected[1]) < 1e-12, `${actual[1]} !== ${expected[1]}`);
}

test("free placement preserves a distinct boundary just above a saved plot", () => {
  const corners = [[0.3, 0.496], [0.7, 0.496]];
  for (const raw of corners) {
    for (const options of [undefined, { enabled: false }]) {
      const result = snapPoint(raw, [savedPlot], 1000, 1000, options);
      assert.equal(result.kind, "none");
      assert.strictEqual(result.point, raw);
    }
  }
  assert.equal(corners[0][1], 0.496);
  assert.equal(corners[1][1], 0.496);
  assert.deepEqual(savedPlot, [[0.3, 0.5], [0.7, 0.5], [0.7, 0.7], [0.3, 0.7]]);
});

test("free placement also preserves deliberate positions next to a saved vertex", () => {
  const raw = [0.302, 0.498];
  for (const options of [undefined, { enabled: false }, { thresholdPx: 100 }]) {
    const result = snapPoint(raw, [savedPlot], 1000, 1000, options);
    assert.equal(result.kind, "none");
    assert.strictEqual(result.point, raw);
  }
});

test("explicit snapping aligns nearby vertices and edges within six screen pixels", () => {
  const vertex = snapPoint([0.302, 0.498], [savedPlot], 1000, 1000, { enabled: true });
  assert.equal(vertex.kind, "vertex");
  closePoint(vertex.point, [0.3, 0.5]);

  const edge = snapPoint([0.4, 0.495], [savedPlot], 1000, 1000, { enabled: true });
  assert.equal(edge.kind, "edge");
  closePoint(edge.point, [0.4, 0.5]);
  assert.ok(Math.abs(edge.distance - 5) < 1e-9);

  const raw = [0.4, 0.493];
  const outside = snapPoint(raw, [savedPlot], 1000, 1000, { enabled: true });
  assert.equal(outside.kind, "none");
  assert.strictEqual(outside.point, raw);
});

test("vertex priority remains available for intentionally shared corners", () => {
  // The edge is only one pixel away, but a corner within the enabled radius
  // takes priority so adjacent plots can reuse exactly the same saved vertex.
  const result = snapPoint([0.304, 0.499], [savedPlot], 1000, 1000, { enabled: true });
  assert.equal(result.kind, "vertex");
  closePoint(result.point, [0.3, 0.5]);

  const edge = snapPoint([0.307, 0.499], [savedPlot], 1000, 1000, { enabled: true });
  assert.equal(edge.kind, "edge");
  closePoint(edge.point, [0.307, 0.5]);
});

test("snap radius uses screen pixels at 2000 percent zoom on a non-square image", () => {
  const width = 20000;
  const height = 10000;
  const nearby = snapPoint([0.4, 0.5 - 5 / height], [savedPlot], width, height, { enabled: true });
  assert.equal(nearby.kind, "edge");
  closePoint(nearby.point, [0.4, 0.5]);

  const raw = [0.4, 0.5 - 7 / height];
  const outside = snapPoint(raw, [savedPlot], width, height, { enabled: true });
  assert.equal(outside.kind, "none");
  assert.strictEqual(outside.point, raw);
});

test("quarter-turn views retain the same screen distance after source axes are swapped", () => {
  // A 20000 x 10000 source renders in a 10000 x 20000 quarter-turn viewport.
  // Its source dimensions must be recovered from viewport height and width.
  const viewport = { width: 10000, height: 20000 };
  const sourceWidth = viewport.height;
  const sourceHeight = viewport.width;
  const nearby = snapPoint([0.4, 0.5 - 4 / sourceHeight], [savedPlot], sourceWidth, sourceHeight, { enabled: true });
  assert.equal(nearby.kind, "edge");
  closePoint(nearby.point, [0.4, 0.5]);

  const raw = [0.3 - 8 / sourceWidth, 0.6];
  const outside = snapPoint(raw, [savedPlot], sourceWidth, sourceHeight, { enabled: true });
  assert.equal(outside.kind, "none");
  assert.strictEqual(outside.point, raw);
});

test("an explicit radius is honored only while snapping is enabled", () => {
  const raw = [0.4, 0.49];
  const small = snapPoint(raw, [savedPlot], 1000, 1000, { enabled: true, thresholdPx: 6 });
  assert.equal(small.kind, "none");
  const large = snapPoint(raw, [savedPlot], 1000, 1000, { enabled: true, thresholdPx: 12 });
  assert.equal(large.kind, "edge");
  closePoint(large.point, [0.4, 0.5]);
});
