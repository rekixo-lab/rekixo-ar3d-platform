import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mapper = await readFile(
  new URL("../app/plot-mapper.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("precision mapper removes transition chasing during zoom", () => {
  assert.match(css, /Rekixo Mapper V5\.6/);
  assert.match(
    css,
    /\.mapper-v4-canvas \.mapper-image-wrap\s*\{[^}]*transition:\s*none !important/s,
  );
  assert.match(
    css,
    /\.mapper-v4-canvas\s*\{[^}]*scroll-behavior:\s*auto !important/s,
  );
});

test("pointer movement consumes newest coalesced browser sample", () => {
  assert.match(mapper, /function latestPointerClient/);
  assert.match(mapper, /getCoalescedEvents/);
  assert.match(mapper, /const pointer = latestPointerClient\(event\)/);
  assert.match(mapper, /pan\.lastX - pointer\.x/);
  assert.match(mapper, /pan\.lastY - pointer\.y/);
});

test("corner handle preview is RAF batched and commits React state only at drag end", () => {
  assert.match(mapper, /handleFrameRef/);
  assert.match(mapper, /pendingHandleRef/);
  assert.match(mapper, /function renderHandlePreview/);
  assert.match(mapper, /function queueHandleFrame/);
  assert.match(mapper, /requestAnimationFrame/);
  assert.match(mapper, /draft\.setAttribute/);
  assert.match(mapper, /setPoints\(pointsRef\.current\.map/);

  const moveStart = mapper.indexOf("function moveHandle");
  const moveEnd = mapper.indexOf("function endHandle", moveStart);
  const moveBody = mapper.slice(moveStart, moveEnd);
  assert.doesNotMatch(moveBody, /setPoints\(/);
});

test("manual placement starts free and applies optional snapping without changing canonical coordinates", () => {
  assert.match(mapper, /\[snapEnabled,\s*setSnapEnabled\]\s*=\s*useState\(false\)/);
  assert.match(mapper, /enabled:\s*snapEnabled/);
  assert.match(mapper, /aria-pressed=\{snapEnabled\}/);
  assert.doesNotMatch(mapper, /18 \/ Math\.sqrt\(Math\.max\(1, zoomRef\.current\)\)/);
  assert.match(mapper, /polygon:\s*JSON\.stringify\(points\)/);
  assert.match(mapper, /verifyPlotPersistence\(saved\)/);
});

test("loupe is imperative so handle dragging does not rerender the whole mapper for magnification", () => {
  assert.match(mapper, /loupeRef/);
  assert.match(mapper, /loupe\.style\.backgroundPosition/);
  assert.doesNotMatch(mapper, /\[loupePoint,\s*setLoupePoint\]/);
  assert.doesNotMatch(mapper, /\[draggingPoint,\s*setDraggingPoint\]/);
});

test("draft selection guide stays 60 percent thinner than the canonical mapped polygon stroke", () => {
  assert.match(
    css,
    /\.mapper-image-wrap polygon\s*\{[^}]*stroke-width:\s*3;/s,
  );
  assert.match(
    css,
    /\.mapper-image-wrap polygon\.draft\s*\{[^}]*stroke-width:\s*1\.2;/s,
  );
});

