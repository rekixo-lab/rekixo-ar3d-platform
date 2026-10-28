import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");

test("Available / Booked / Sold filters force-hide every non-matching 2D overlay", () => {
  assert.match(
    html,
    /\.show-all\.status-filter-available \.plot:not\(\[data-status="available"\]\),\.show-all\.status-filter-booked \.plot:not\(\[data-status="booked"\]\),\.show-all\.status-filter-sold \.plot:not\(\[data-status="sold"\]\)\{fill:rgba\(0,0,0,0\)!important;stroke:transparent!important;filter:none!important\}/,
  );
});

test("exclusive filter rule cannot be overridden by the all-status !important palette", () => {
  assert.match(
    html,
    /\.show-all\.status-filter-available \.plot:not\(\[data-status="available"\]\),\.show-all\.status-filter-booked \.plot:not\(\[data-status="booked"\]\),\.show-all\.status-filter-sold \.plot:not\(\[data-status="sold"\]\)\{fill:rgba\(0,0,0,0\)!important;stroke:transparent!important;filter:none!important\}/,
  );
  assert.match(
    html,
    /\.show-all \.plot\[data-status="available"\]\{fill:rgba\(var\(--status-overlay-available-rgb\),\.24\)!important;stroke:rgba\(var\(--status-overlay-available-rgb\),\.86\)!important\}/,
  );
  assert.match(
    html,
    /\.show-all \.plot\[data-status="booked"\]\{fill:rgba\(var\(--status-overlay-booked-rgb\),\.31\)!important;stroke:rgba\(var\(--status-overlay-booked-rgb\),\.92\)!important\}/,
  );
  assert.match(
    html,
    /\.show-all \.plot\[data-status="sold"\]\{fill:rgba\(var\(--status-overlay-sold-rgb\),\.34\)!important;stroke:rgba\(var\(--status-overlay-sold-rgb\),\.94\)!important\}/,
  );
  // The exclusive selector has an additional status-filter class and therefore
  // remains more specific than the generic all-status selector; both still use
  // !important exactly as production requires.
  assert.match(html, /\.show-all\.status-filter-available \.plot:not/);
});

test("single-select status behavior remains unchanged", () => {
  assert.match(html, /function setStatusFilter\(st\)/);
  assert.match(html, /svg\.classList\.add\('status-filter-'\+st\)/);
  assert.match(html, /engine3D\?\.setStatusFilter\?\.\(st\)/);
  assert.match(html, /function ensureStatusOverlayOn\(\)/);
});

test("3D already renders only the active status and geometry stays canonical", () => {
  assert.match(
    three,
    /if\(!this\.matchesStatusFilter\(p\)\)continue/,
  );
  assert.match(
    three,
    /!this\.showAll\|\|this\.matchesStatusFilter\(p\)/,
  );
  assert.match(html, /function pointInPolygon\(/);
  assert.match(html, /matrixTransform\(ctm\.inverse\(\)\)/);
});
