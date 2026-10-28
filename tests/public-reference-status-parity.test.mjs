import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");

test("2D selection and drawer use the canonical plot status", () => {
  assert.match(html, /REKIXO_REFERENCE_STATUS_PARITY_V1/);
  assert.match(html, /\.plot\.selected\[data-status="available"\]/);
  assert.match(html, /\.plot\.selected\[data-status="booked"\]/);
  assert.match(html, /\.plot\.selected\[data-status="sold"\]/);
  assert.match(html, /drawer\.dataset\.status=st/);
  assert.match(html, /id="plotStatusChip"/);
  assert.match(html, /textContent='Plot #'/);
});

test("mobile reference status card keeps Available Booked Sold and Total visible", () => {
  assert.match(html, /status-body \.status-line\.total\{display:flex!important/);
  assert.match(html, /data-status-filter="available"/);
  assert.match(html, /data-status-filter="booked"/);
  assert.match(html, /data-status-filter="sold"/);
});

test("status normalization trims storage values without changing the three canonical states", () => {
  assert.match(html, /String\(p\?\.status\|\|'available'\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(three, /const statusOf=p=>/);
  assert.match(three, /\.trim\(\)\.toLowerCase\(\)/);
});

test("3D status overlay is gated by the same master toggle as 2D", () => {
  assert.match(three, /if\(this\.showAll\)\{gl\.depthMask\(false\)/);
  assert.doesNotMatch(three, /if\(this\.showAll\|\|this\.statusFilter\)/);
});

test("3D selected plot inherits available booked or sold palette", () => {
  assert.match(three, /const statusPalette=/);
  assert.match(three, /statusPalette\(statusOf\(this\.selected\)\)/);
});

test("3D plot-number badges are projected from plot centers and only shown with status overlay", () => {
  assert.match(html, /\.three-label-layer/);
  assert.match(html, /\.three-plot-label/);
  assert.match(three, /rebuildLabels\(\)/);
  assert.match(three, /layoutLabels\(\)/);
  assert.match(three, /this\.active&&this\.showAll/);
  assert.match(three, /Array\.isArray\(p\.center\)/);
});

test("future plot-facing field is presentation-only and safely falls back to road access", () => {
  assert.match(html, /id="roadLabel"/);
  assert.match(html, /const facing=String\(p\.facing\|\|''\)\.trim\(\)/);
  assert.match(html, /facing\?'FACING':'ROAD ACCESS'/);
  assert.match(html, /facing\|\|p\.road\|\|'—'/);
});

test("canonical polygon and hit-test engines remain present", () => {
  assert.match(html, /function pointInPolygon\(/);
  assert.match(three, /function inside\(/);
  assert.match(three, /pick\(x,y\)/);
});


test("3D status filter hides stale labels synchronously and clears a mismatched selected plot", () => {
  assert.match(three, /syncLabelVisibility\(\)/);
  assert.match(three, /this\.selected&&this\.statusFilter&&!this\.matchesStatusFilter\(this\.selected\)/);
  assert.match(three, /el\.hidden=true/);
});

test("public 2D focus and 3D badges share the same robust geometry label point", () => {
  assert.match(html, /project-geometry\.js/);
  assert.match(html, /projectLabelPoint\(mapped\)/);
  assert.match(three, /RekixoProjectGeometry/);
  assert.match(three, /plotLabelPoint\(p\)/);
});

test("3D label layout suppresses only overlapping badges while keeping the selected label first", () => {
  assert.match(three, /const cellW=34,cellH=24,buckets=new Map\(\)/);
  assert.match(three, /if\(!item\.selected&&collision\(item\.x,item\.y\)\)continue/);
});
