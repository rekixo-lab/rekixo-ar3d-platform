import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");

test("2D customer-site overlay palette is 20 percent darker for better visibility", () => {
  assert.match(html, /--status-overlay-available-rgb:26,174,96/);
  assert.match(html, /--status-overlay-booked-rgb:197,148,22/);
  assert.match(html, /--status-overlay-sold-rgb:191,41,62/);

  // Exact integer rounding of bright RGB * 0.80.
  assert.deepEqual(
    [
      [Math.round(32 * .80), Math.round(217 * .80), Math.round(120 * .80)],
      [Math.round(246 * .80), Math.round(185 * .80), Math.round(27 * .80)],
      [Math.round(239 * .80), Math.round(51 * .80), Math.round(78 * .80)],
    ],
    [[26,174,96],[197,148,22],[191,41,62]],
  );
});

test("2D all-status and selected surfaces consume the darker palette", () => {
  assert.match(html, /\.show-all \.plot\[data-status="available"\]\{fill:rgba\(var\(--status-overlay-available-rgb\),\.24\)!important/);
  assert.match(html, /\.show-all \.plot\[data-status="booked"\]\{fill:rgba\(var\(--status-overlay-booked-rgb\),\.31\)!important/);
  assert.match(html, /\.show-all \.plot\[data-status="sold"\]\{fill:rgba\(var\(--status-overlay-sold-rgb\),\.34\)!important/);
  assert.match(html, /\.plot\.selected\[data-status="available"\]\{fill:rgba\(var\(--status-overlay-available-rgb\),\.42\)!important/);
  assert.match(html, /\.plot\.selected\[data-status="booked"\]\{fill:rgba\(var\(--status-overlay-booked-rgb\),\.44\)!important/);
  assert.match(html, /\.plot\.selected\[data-status="sold"\]\{fill:rgba\(var\(--status-overlay-sold-rgb\),\.48\)!important/);
});

test("legend and 3D number-badge identity colors stay bright and readable", () => {
  assert.match(html, /--status-available:#20d978/);
  assert.match(html, /--status-booked:#f6b91b/);
  assert.match(html, /--status-sold:#ef334e/);
  assert.match(html, /\.three-plot-label\.available\{border-color:var\(--status-available\)\}/);
  assert.match(html, /\.three-plot-label\.booked\{border-color:var\(--status-booked\)\}/);
  assert.match(html, /\.three-plot-label\.sold\{border-color:var\(--status-sold\)\}/);
});

test("3D plot surfaces use one explicit 0.80 RGB multiplier", () => {
  assert.match(three, /const STATUS_OVERLAY_DARKEN=\.80/);
  assert.match(
    three,
    /const dimStatus=c=>\[c\[0\]\*STATUS_OVERLAY_DARKEN,c\[1\]\*STATUS_OVERLAY_DARKEN,c\[2\]\*STATUS_OVERLAY_DARKEN,c\[3\]\]/,
  );
  assert.match(three, /top:dimStatus\(\[\.94,\.08,\.15,\.52\]\)/);
  assert.match(three, /this\.metroFourStatus\?dimStatus\(st==='agreement'/);
});

test("geometry filtering picking and camera contracts remain unchanged", () => {
  assert.match(html, /function pointInPolygon\(/);
  assert.match(html, /matrixTransform\(ctm\.inverse\(\)\)/);
  assert.match(three, /this\.matchesStatusFilter\(p\)/);
  assert.match(three, /pick\(x,y\)/);
  assert.match(three, /cameraMetrics\(/);
});
