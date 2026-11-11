import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");

function cssPx(name) {
  const match = page.match(new RegExp(`--${name}:([0-9.]+)px`));
  assert.ok(match, `missing CSS token --${name}`);
  return Number(match[1]);
}

test("Amenities, Gallery and Location buttons share the same compact width contract", () => {
  const desktopBaseline = 114.5;
  const mobileBaseline = 144.5;

  assert.equal(cssPx("action-pill-width"), 80.15);
  assert.equal(cssPx("action-pill-mobile-width"), 101.15);
  assert.ok(Math.abs(cssPx("action-pill-width") - desktopBaseline * 0.70) < 0.001);
  assert.ok(Math.abs(cssPx("action-pill-mobile-width") - mobileBaseline * 0.70) < 0.001);

  assert.match(
    page,
    /\.pill\{width:var\(--action-pill-width\);height:40px;padding:0 6px/,
  );

  const mobile = page.match(
    /\.pill\{width:var\(--action-pill-mobile-width\);height:49px;padding:0 8px;border-radius:14px;font-size:9\.6px;gap:5px/g,
  ) || [];
  assert.equal(mobile.length, 2);

  // Negative assertions intentionally mention the OLD widths.
  // They prove the legacy literal CSS declarations are gone.
  assert.doesNotMatch(page, /\.pill\{width:114\.5px/);
  assert.doesNotMatch(page, /\.pill\{width:144\.5px/);
});

test("button heights, ids, order and icons remain stable", () => {
  assert.match(page, /id="amenitiesBtn"/);
  assert.match(page, /id="galleryBtn"/);
  assert.match(page, /id="locationBtn"/);
  assert.match(page, /id="amenitiesBtn"[\s\S]*id="galleryBtn"[\s\S]*id="locationBtn"/);
  assert.match(page, /\.pill \.pin\{width:14px;height:17px/);
  assert.match(page, /\.pill \.gallery\{width:14px;height:14px/);
  assert.match(page, /height:40px/);
  assert.match(page, /height:49px/);
  assert.match(page, /q\('#amenitiesBtn'\)\.onclick=openAmenities/);
  assert.match(page, /const fallback=isMangalRajPark\(\)/);
  assert.match(page, /category=amenity/);
  assert.match(page, /document\.getElementById\('amenitiesBtn'\)[\s\S]*document\.getElementById\('galleryBtn'\)[\s\S]*document\.getElementById\('locationBtn'\)/);
});

test("mobile HUD keeps a safe screen-edge gutter and a real column gap", () => {
  assert.match(page, /--rekixo-hud-right:max\(14px,env\(safe-area-inset-right,0px\)\)/);
  assert.match(page, /--rekixo-hud-bottom:max\(14px,env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(page, /--rekixo-hud-control-size:38px/);
  assert.match(page, /--rekixo-hud-column-gap:10px/);
  assert.match(page, /right:calc\(var\(--rekixo-hud-right\) \+ var\(--rekixo-hud-control-size\) \+ var\(--rekixo-hud-column-gap\)\)/);
});

test("trim remains presentation-only and preserves map interaction anchors", () => {
  assert.match(page, /function pointInPolygon/);
  assert.match(page, /svg\.getScreenCTM\?\.\(\)/);
  assert.match(page, /matrixTransform\(ctm\.inverse\(\)\)/);
});
