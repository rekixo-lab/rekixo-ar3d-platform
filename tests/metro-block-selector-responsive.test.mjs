import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Metro City selector keeps published A/B/C navigation and phone/admin entry points",()=>{
  const page=read("app/metro-block-selector.tsx");
  assert.match(page,/METRO_BLOCK_KEYS\.map/);
  assert.match(page,/publishedMetroBlock\(METRO_BLOCK_PROJECT_ID,b\)/);
  assert.match(page,/aria-label="Call Metro City"/);
  assert.match(page,/aria-label="Open Metro City admin panel"/);
  assert.match(page,/admin-login/);
  assert.match(page,/logoUrl/);
  assert.match(page,/masterplan\?projectSlug=metro-city-c024a5/);
  assert.match(page,/metro-block-selector\.module\.css/);
  assert.doesNotMatch(page,/Residential plots across 3 blocks/);
});

test("Metro City mobile header reserves a separate subtitle row and icons at the top right",()=>{
  const css=read("app/metro-block-selector.module.css");
  const mobile=css.slice(css.indexOf("@media (max-width: 599px) {"),css.indexOf("@media (max-width: 599px) and"));
  assert.match(mobile,/grid-template-areas:\s*"brand actions" "subtitle subtitle"/);
  assert.match(mobile,/\.actions\s*\{[^}]*gap:/);
  assert.match(mobile,/\.subtitleFull\s*\{\s*display:\s*none/);
  assert.match(mobile,/\.subtitleCompact\s*\{\s*display:\s*inline/);
  assert.match(mobile,/\.cards\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(mobile,/\.card\s*\{\s*display:\s*grid;\s*grid-template-columns:/);
  assert.match(css,/@media \(min-width: 600px\) and \(max-width: 1023px\)/);
  assert.match(css,/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/\.card:focus-visible/);
});
