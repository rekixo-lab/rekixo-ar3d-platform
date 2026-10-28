import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");

test("status rows are deterministic one-at-a-time filters and force the overlay ON", () => {
  assert.match(html, /REKIXO_STATUS_FILTER_COMPACT_V2/);
  assert.match(html, /function ensureStatusOverlayOn\(\)\{if\(showAll\)return;showAll=true;/);
  assert.match(html, /function setStatusFilter\(st\).*ensureStatusOverlayOn\(\);statusFilter=st;/s);
  assert.doesNotMatch(html, /if\(statusFilter===st\).*clearStatusFilter/s);
  assert.match(html, /Showing '\+statusDisplayLabel\(st\)\+' plots'/);
  assert.match(html, /metroAgreementMode&&label==='sold'\?'Registered'/);
  assert.match(html, /renderMetroStatusLabels\(\)/);
  assert.match(html, /data-status-filter="available" aria-pressed="false"/);
  assert.match(html, /data-status-filter="booked" aria-pressed="false"/);
  assert.match(html, /data-status-filter="sold" aria-pressed="false"/);
});

test("turning the master status toggle OFF clears the active row filter", () => {
  assert.match(html, /function toggleBoundaries\(\)\{showAll=!showAll;if\(!showAll\)clearStatusFilter\(true\);/);
  assert.match(html, /engine3D\?\.setShowAll\(showAll\)/);
});

test("coarse-pointer status selection commits on pointer release", () => {
  assert.match(html, /pointerup',e=>\{if\(isCoarse\(e\)&&glassOpt\)setStatusFilter\(glassOpt\.dataset\.statusFilter\)/);
  assert.doesNotMatch(html, /paintGlass\(e\).*setStatusFilter\(glassOpt\.dataset\.statusFilter,true\)/s);
});

test("status card is exactly 30 percent narrower without changing its vertical layout", () => {
  assert.match(html, /--status-card-width:117\.6px/);
  const uses = html.match(/width:var\(--status-card-width\)/g) || [];
  assert.equal(uses.length, 2);
  assert.match(html, /body\[data-metro-four-status="1"\] \.status\{width:168px/);
  assert.match(html, /status-head[^}]*height:49px/);
});

test("2D and 3D filtering keep canonical geometry untouched", () => {
  assert.match(html, /function pointInPolygon\(/);
  assert.match(html, /svg\.getScreenCTM\?\.\(\)/);
  assert.match(html, /matrixTransform\(ctm\.inverse\(\)\)/);
  assert.match(three, /pick\(x,y\)/);
  assert.match(three, /!this\.showAll\|\|this\.matchesStatusFilter\(p\)/);
});
