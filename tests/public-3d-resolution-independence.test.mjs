import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");

function metrics(){
  const sandbox={window:{}};
  vm.runInNewContext(three,sandbox,{filename:"three-view.js"});
  return sandbox.window.RekixoThreeViewMetrics;
}

test("masterplan pixel resolution no longer changes 3D world diagonal",()=>{
  const m=metrics();
  assert.ok(m);
  const diag=(w,h)=>Math.hypot(w*m.worldUnitFor(w,h),h*m.worldUnitFor(w,h));
  const a=diag(1200,2133);
  const b=diag(4800,8532);
  const c=diag(8000,2000);
  assert.ok(Math.abs(a-b)<1e-8);
  assert.ok(Math.abs(a-c)<1e-8);
  assert.ok(Math.abs(a-m.referenceWorldDiagonal)<1e-8);
});

test("camera distances and clipping derive from normalized world geometry",()=>{
  const m=metrics();
  const u=m.worldUnitFor(4800,8532);
  const c=m.cameraMetrics(4800*u,8532*u);
  assert.ok(c.minDistance<c.baseDistance);
  assert.ok(c.baseDistance<c.maxDistance);
  assert.ok(c.nearPlane>0);
  assert.ok(c.farPlane>c.maxDistance);
  assert.match(three,/this\.minDistance,this\.maxDistance/);
  assert.match(three,/this\.nearPlane,this\.farPlane/);
});

test("picking focus and plan conversion use the same per-project unit",()=>{
  assert.match(three,/this\.unit=worldUnitFor\(this\.imgW,this\.imgH\)/);
  assert.match(three,/hit\[0\]\/this\.unit\+this\.imgW\/2/);
  assert.match(three,/\(p\[0\]-this\.imgW\/2\)\*this\.unit/);
  assert.match(three,/\(c\[0\]-this\.imgW\/2\)\*this\.unit/);
  assert.doesNotMatch(three,/hit\[0\]\/UNIT/);
  assert.doesNotMatch(three,/this\.worldW=this\.imgW\*UNIT/);
});

test("3D number labels stay ground-locked with only screen-pixel lift",()=>{
  assert.match(three,/LABEL_SCREEN_LIFT_PX=7/);
  assert.match(three,/const c=plotLabelPoint\(p\),w=this\.wp\(c,0\)/);
  assert.match(three,/height-LABEL_SCREEN_LIFT_PX/);
  assert.doesNotMatch(three,/this\.wp\(c,\.055\)/);
});

test("status filters collision handling polygons and 2D contracts stay present",()=>{
  assert.match(three,/this\.matchesStatusFilter\(p\)/);
  assert.match(three,/this\.selected&&!this\.matchesStatusFilter\(this\.selected\)/);
  assert.match(three,/const cellW=34,cellH=24,buckets=new Map\(\)/);
  assert.match(three,/inside\(px,py,p\.points\)/);
  assert.match(html,/function pointInPolygon\(/);
  assert.match(html,/engine3D\?\.setStatusFilter\?\.\(statusFilter\)/);
});
