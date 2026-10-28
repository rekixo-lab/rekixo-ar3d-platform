import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../public/project/index.html", import.meta.url),
  "utf8",
);
const asset = await readFile(
  new URL("../app/api/project-asset/[kind]/route.ts", import.meta.url),
  "utf8",
);

test("public runtime never prefetches a bundled tenant masterplan", () => {
  assert.doesNotMatch(page, /class="master" src="masterplan\.jpg"/);
  assert.doesNotMatch(page, /master\.src='masterplan\.jpg'/);
  assert.match(page, /preferredMasterUrl='\/api\/project-asset\/masterplan\?'/);
});

test("public project prefers optimized derivative and falls back safely", () => {
  assert.match(page, /publicParams\.set\('variant','public'\)/);
  assert.match(page, /canonicalMasterUrl/);
  assert.match(page, /aspectError>0\.015/);
  assert.match(page, /loadMaster\(true,true\)/);
  assert.match(asset, /wantsPublicMasterplan/);
  assert.match(asset, /masterplanPublic/);
  assert.match(asset, /canonical-fallback/);
});

test("boot stays visible until the original source is fully decoded and drawn", () => {
  assert.match(page,/const revealShell=/);
  assert.match(page,/Loading original masterplan…/);
  assert.match(page,/prepareOriginalMasterplan\(/);
  assert.match(page,/if\(typeof master\.decode==='function'\)await master\.decode\(\)/);
  assert.match(page,/\/\/ Reset draws the original canvas BEFORE exposing the customer page/);
  assert.match(page,/document\.documentElement\.classList\.remove\('rekixo-project-loading'/);
  assert.match(page,/master\.onerror=masterFailed/);
});

test("mobile pan and zoom use compositor and freshest pointer sample", () => {
  assert.match(page, /translate3d\(calc\(-50%/);
  assert.match(page, /getCoalescedEvents/);
  assert.match(page, /const sample=latestPointerSample\(e\)/);
  assert.match(page, /overscroll-behavior:none/);
  assert.match(page, /backdrop-filter:none!important/);
});

test("performance changes never rewrite polygon storage", () => {
  assert.match(page, /const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
  assert.doesNotMatch(asset, /UPDATE plots/);
});
