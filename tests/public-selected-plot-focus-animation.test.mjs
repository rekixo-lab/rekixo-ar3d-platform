import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, three] = await Promise.all([
  readFile(new URL("../public/project/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8"),
]);

test("2D selected plot gets one status-aware moving light focus effect", () => {
  assert.match(page, /REKIXO_SELECTED_PLOT_FOCUS_FX_V1/);
  assert.match(page, /\.plot\.selected\[data-status\]\{[^}]*stroke-dasharray:15 8[^}]*animation:rekixo-selected-edge 1\.45s linear infinite,rekixo-selected-pulse 2\.1s ease-in-out infinite/);
  assert.match(page, /@keyframes rekixo-selected-edge\{to\{stroke-dashoffset:-46\}\}/);
  assert.match(page, /@keyframes rekixo-selected-pulse/);
});

test("2D focus effect follows the selected project's Available Booked Sold colors", () => {
  assert.match(page, /\.plot\.selected\[data-status="available"\]\{--rekixo-focus-rgb:var\(--plot-available-rgb\)\}/);
  assert.match(page, /\.plot\.selected\[data-status="booked"\]\{--rekixo-focus-rgb:var\(--plot-booked-rgb\)\}/);
  assert.match(page, /\.plot\.selected\[data-status="sold"\]\{--rekixo-focus-rgb:var\(--plot-sold-rgb\)\}/);
  assert.match(page, /rgba\(var\(--rekixo-focus-rgb\),\.95\)/);
});

test("2D animation pauses during gestures and respects reduced motion", () => {
  assert.match(page, /\.map\.dragging \.plot\.selected\[data-status\],\.map\.gesture-active \.plot\.selected\[data-status\]\{animation:none/);
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{/);
  assert.match(page, /\.plot\.selected\[data-status\]\{animation:none;stroke-dasharray:none/);
});

test("3D selected plot uses a lightweight moving shader sweep", () => {
  assert.match(three, /REKIXO_SELECTED_3D_FOCUS_FX_V1_1/);
  assert.match(three, /uniform float uFxTime,uFxMix/);
  assert.match(three, /smoothstep\(\.72,1\.0,wave\)\*uFxMix/);
  assert.match(three, /gl\.getUniformLocation\(this\.cp,'uFxTime'\)/);
  assert.match(three, /gl\.getUniformLocation\(this\.cp,'uFxMix'\)/);
});

test("3D focus loop runs only for a selected idle plot and is capped near 30fps", () => {
  assert.match(three, /const animateFx=Boolean\(this\.selected&&!this\.motionReduced&&!this\.ptr\.size\)/);
  assert.match(three, /now-this\.fxLast<32/);
  assert.match(three, /if\(animateFx&&this\.active&&!this\.raf\)this\.raf=requestAnimationFrame\(t=>this\.render\(t\)\)/);
  assert.doesNotMatch(three, /setInterval\(/);
});

test("3D selection restarts the effect and pointer release resumes it", () => {
  assert.match(three, /this\.selectionFxStart=animationNow\(\);this\.fxLast=0/);
  assert.match(three, /else if\(!this\.ptr\.size\)\{this\.g=null;this\.request\(\)\}/);
  assert.match(three, /requestAnimationFrame\(t=>this\.render\(t\)\)/);
});

test("3D animation clock is safe without a VM performance global", () => {
  assert.match(three, /const animationNow=\(\)=>globalThis\.performance&&typeof globalThis\.performance\.now==='function'\?globalThis\.performance\.now\(\):Date\.now\(\)/);
  assert.doesNotMatch(three, /selectionFxStart=performance\.now\(\)|render\(now=performance\.now\(\)\)/);
});

test("3D geometry and picking source remain canonical", () => {
  assert.match(three, /function inside\(x,y,p\)/);
  assert.match(three, /p=this\.plots\.find\(p=>\(!this\.showAll\|\|this\.matchesStatusFilter\(p\)\)&&inside\(px,py,p\.points\)\)/);
  assert.match(three, /build\(p\)\{const gl=this\.gl,H=0\.55,top=\[\],sh=\[\],side=\[\],loop=\[\],vert=\[\]/);
  assert.match(three, /wp\(p,y=\.02\)\{return\[\(p\[0\]-this\.imgW\/2\)\*this\.unit,y,\(p\[1\]-this\.imgH\/2\)\*this\.unit\]\}/);
});

test("focus effect stays presentation-only", () => {
  assert.doesNotMatch(page, /fetch\([^)]*focus/i);
  assert.doesNotMatch(three, /DB\.|R2|fetch\(/);
  assert.match(page, /function setSelected\(id\)\{svg\.querySelectorAll\('\.plot'\)\.forEach\(el=>el\.classList\.toggle\('selected',el\.dataset\.plotId===id\)\)\}/);
});
