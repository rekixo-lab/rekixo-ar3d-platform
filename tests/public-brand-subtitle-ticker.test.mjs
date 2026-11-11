import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");

test("brand subtitle is structurally isolated from title and header actions", () => {
  assert.match(page, /REKIXO_RESPONSIVE_BRAND_SUBTITLE_TICKER_V1_1/);
  assert.match(page, /<small class="brand-subtitle" id="brandSubtitle"><span class="brand-subtitle-track" id="brandSubtitleTrack">RAIGARH, CHHATTISGARH<\/span><\/small>/);
  assert.match(page, /\.brandrow\{width:100%;max-width:100%;min-width:0;overflow:hidden\}/);
  assert.match(page, /\.brand\{flex:1 1 0;min-width:0;max-width:100%;overflow:hidden\}/);
  assert.match(page, /\.head-actions\{flex:0 0 auto;flex-shrink:0\}/);
});

test("subtitle is clipped and cannot widen the page", () => {
  assert.match(page, /REKIXO_RESPONSIVE_BRAND_SUBTITLE_LEFT_HALF_V2/);
  assert.match(page, /\.brand-subtitle\{display:block;width:var\(--rekixo-subtitle-lane-width,100%\);max-width:100%;min-width:0;margin-left:0;margin-right:auto;overflow:hidden;white-space:nowrap;contain:paint\}/);
  assert.match(page, /\.brand-subtitle-track\{display:inline-block;width:max-content;max-width:none;white-space:nowrap;will-change:transform\}/);
});

test("mobile subtitle right edge is capped at the visual viewport midpoint", () => {
  assert.match(page, /function syncBrandSubtitleLaneWidth\(\)/);
  assert.match(page, /const viewportWidth=Math\.max\(1,Number\(vv\?\.width\|\|document\.documentElement\.clientWidth\|\|window\.innerWidth\|\|1\)\)/);
  assert.match(page, /if\(viewportWidth>700&&!dungarCompact\)\{/);
  assert.match(page, /const viewportLeft=Number\(vv\?\.offsetLeft\|\|0\)/);
  assert.match(page, /const laneLeft=subtitleLane\.getBoundingClientRect\(\)\.left/);
  assert.match(page, /const halfScreenRight=viewportLeft\+\(viewportWidth\*\.5\)/);
  assert.match(page, /const leftHalfSpace=Math\.max\(0,Math\.floor\(halfScreenRight-laneLeft\)\)/);
  assert.match(page, /const laneWidth=Math\.max\(0,Math\.min\(parentWidth,leftHalfSpace,actionSafeSpace\)\)/);
  assert.match(page, /subtitleLane\.style\.setProperty\('--rekixo-subtitle-lane-width',laneWidth\+'px'\)/);
});

test("left-half sizing happens before ticker width is measured", () => {
  const sizeCall=page.indexOf("syncBrandSubtitleLaneWidth();");
  const widthRead=page.indexOf("const originalWidth=Math.ceil(subtitleTrack.scrollWidth)");
  assert.ok(sizeCall >= 0 && widthRead > sizeCall);
});

test("desktop overflow pauses, pans to the last character, pauses, then returns while mobile keeps its existing motion", () => {
  assert.match(page, /const originalWidth=Math\.ceil\(subtitleTrack\.scrollWidth\)/);
  assert.match(page, /const laneWidth=Math\.ceil\(subtitleLane\.clientWidth\)/);
  assert.match(page, /const overflow=originalWidth-laneWidth/);
  assert.match(page, /if\(overflow<=3\)return/);
  assert.match(page, /if\(viewportWidth>900\)\{/);
  assert.match(page, /let subtitleDesktopAnimation=null/);
  assert.match(page, /function stopDesktopSubtitleAnimation\(\)/);
  assert.match(page, /subtitleLane\.classList\.add\('is-desktop-pan'\)/);
  assert.match(page, /if\(typeof subtitleTrack\.animate==='function'\)/);
  assert.match(page, /subtitleDesktopAnimation=subtitleTrack\.animate\(/);
  assert.match(page, /\{transform:'translate3d\(0,0,0\)',offset:0\}/);
  assert.match(page, /\{transform:'translate3d\(0,0,0\)',offset:\.16\}/);
  assert.match(page, /\{transform:shift,offset:\.48\}/);
  assert.match(page, /\{transform:shift,offset:\.64\}/);
  assert.match(page, /\{transform:'translate3d\(0,0,0\)',offset:\.96\}/);
  assert.match(page, /iterations:Infinity/);
  assert.match(page, /subtitleLane\.classList\.add\('is-overflowing'\)/);
  assert.match(page, /\.brand-subtitle\.is-overflowing \.brand-subtitle-track\{animation:rekixo-subtitle-pan/);
});

test("ticker remeasures for project data viewport fonts and layout", () => {
  assert.match(page, /function setBrandSubtitle\(value\)/);
  assert.match(page, /setBrandSubtitle\(\(resolvedAddress\|\|PROJECT_LOCATION\)\.toUpperCase\(\)\)/);
  assert.match(page, /new ResizeObserver\(scheduleBrandSubtitleMotion\)/);
  assert.match(page, /window\.visualViewport\?\.addEventListener\('resize',scheduleBrandSubtitleMotion\)/);
  assert.match(page, /document\.fonts\?\.ready\?\.then\(scheduleBrandSubtitleMotion\)/);
});

test("reduced motion keeps static ellipsis fallback", () => {
  assert.match(page, /const subtitleMotionMQ=window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(page, /if\(subtitleMotionMQ\.matches\)return/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)\{\.brand-subtitle-track\{display:block;width:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;animation:none!important;transform:none!important;will-change:auto\}\}/);
});

test("map geometry remains untouched", () => {
  assert.match(page, /function setMapDimensions\(width,height\)/);
  assert.match(page, /function setSelected\(id\)/);
  assert.match(page, /matrixTransform\(ctm\.inverse\(\)\)/);
  assert.match(page, /const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
});

test("mobile subtitle ticker keeps the existing slower travel timing", () => {
  assert.match(page, /const baseDuration=Math\.max\(7,Math\.min\(12,7\+overflow\/45\)\)/);
  assert.match(page, /const duration=baseDuration\/0\.4/);
  assert.match(page, /Mobile customer-site subtitle ticker keeps the existing slower measured ping-pong motion/);
});

