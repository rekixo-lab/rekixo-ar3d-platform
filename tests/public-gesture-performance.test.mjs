import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../public/project/index.html", import.meta.url),
  "utf8",
);

test("active mobile gestures skip expensive SVG polygon painting", () => {
  assert.match(page, /\.map\.gesture-active:not\(\[data-metro-raster-plots="1"\]\) \.hotspots\{visibility:hidden\}/);
  assert.match(page, /\.map\[data-metro-raster-plots="1"\] \.hotspots\{opacity:0\}/);
  assert.match(page, /setGestureActive\(true\)/);
  assert.match(page, /setGestureActive\(false\)/);
});

test("pan hot path avoids repeated layout reads and unrelated DOM writes", () => {
  assert.match(page, /viewportWidth=viewport\.clientWidth/);
  assert.match(page, /const vw=viewportWidth\|\|viewport\.clientWidth/);
  assert.match(page, /if\(percent!==lastPercent\)/);
  assert.match(page, /const r=gesture\.rect/);
});

test("Android Chrome can use low-latency pointerrawupdate", () => {
  assert.match(
    page,
    /const mapMoveEvent='onpointerrawupdate' in window\?'pointerrawupdate':'pointermove'/,
  );
  assert.match(page, /const sample=latestPointerSample\(e\),tracked=pointers\.get\(e\.pointerId\)/);
  assert.match(page, /tracked\.x=sample\.clientX/);
});

test("wheel and touch rendering stay requestAnimationFrame-coalesced", () => {
  assert.match(page, /function scheduleRender\(\)/);
  assert.match(page, /scale=newScale;scheduleRender\(\)/);
  assert.match(page, /pan\.x=gesture\.pan\.x\+dx;pan\.y=gesture\.pan\.y\+dy;scheduleRender\(\)/);
});

test("smoothness patch does not rewrite polygon coordinates", () => {
  assert.match(
    page,
    /const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/,
  );
});
