import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../public/project/index.html", import.meta.url),
  "utf8",
);

test("mouse focus never paints the browser SVG bounding-box rectangle", () => {
  assert.match(page, /REKIXO_PUBLIC_SVG_FOCUS_SHAPE_V1/);
  assert.match(page, /\.plot:focus\{outline:none\}/);
});

test("keyboard accessibility remains visible on the actual plot geometry", () => {
  assert.match(
    page,
    /\.plot:focus-visible:not\(\.selected\)\{outline:none;stroke:#fff;stroke-width:1\.8;filter:drop-shadow\(0 0 4px rgba\(255,255,255,\.65\)\)\}/,
  );
  assert.match(page, /poly\.setAttribute\('tabindex','0'\)/);
  assert.match(page, /poly\.setAttribute\('role','button'\)/);
  assert.match(page, /poly\.addEventListener\('keydown'/);
});

test("focus fix is presentation-only and canonical polygon hit geometry stays untouched", () => {
  assert.match(page, /function polyPoints\(p\)\{return p\.points\.map/);
  assert.match(page, /function pointInPolygon\(/);
  assert.match(page, /const exact=plots\.find\(p=>metroFilterAllowsPlot\(p\)&&pointInPolygon\(pt\.x,pt\.y,p\.points\)\)/);
  assert.match(page, /poly\.setAttribute\('points',polyPoints\(p\)\)/);
  assert.doesNotMatch(page, /REKIXO_PUBLIC_SVG_FOCUS_SHAPE_V1[\s\S]{0,800}fetch\(/);
});
