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
  assert.match(page,/id="rekixoLoadingScreen"/);
  assert.match(page,/REKIXO_LOADING_PROGRESS\?\.\(100,'Ready'\)/);
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

test("one AR 3D progress screen replaces both sequential loader badges", () => {
  assert.match(page, /<strong>AR3D Vision<\/strong>/);
  assert.match(page, /<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5\.3-8 12-8 12S4 15\.3 4 10a8 8 0 1 1 16 0Z"\/><circle cx="12" cy="10" r="2\.8"\/><\/svg>/);
  assert.match(page, /id="rekixoLoadingTrack"/);
  assert.match(page, /rekixo-loading-snake/);
  assert.match(page, /Original quality preserved/);
  assert.doesNotMatch(page, /\.map\.master-loading::after/);
  assert.doesNotMatch(page, /Loading original masterplan…|Loading project…|आपका प्रोजेक्ट खुल रहा है|हम आपका ओरिजिनल मास्टर प्लान तैयार कर रहे हैं/);
});

test("published original warms while initial live request is pending", () => {
  const warmStart = page.indexOf("rekixoWarmPublishedOriginal(data,REKIXO_BOOT_RUN)");
  const liveWait = page.indexOf("const liveResponse=await livePromise;");
  assert.ok(warmStart > 0 && liveWait > warmStart);
  assert.match(page, /if\(REKIXO_PARAMS\.get\('preview'\)==='1'/);
  assert.match(page, /params\.set\('variant','original'\)/);
  assert.match(page, /params\.set\('fidelity','original-v2'\)/);
  assert.match(page, /link\.rel='preload'/);
  assert.match(page, /if\(warm\?\.src===src\)/);
  assert.match(page, /metadata\.original!==true/);
});
