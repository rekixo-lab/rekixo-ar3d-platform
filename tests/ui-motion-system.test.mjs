import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  globals,
  motion,
  clientAdmin,
  superAdmin,
  publicPage,
  three,
  mapper,
  publicApi,
  schema,
] = await Promise.all([
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/motion-swap.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin-dashboard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/super-admin-dashboard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../public/project/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/plot-mapper.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public-data/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
]);

test("shared admin motion uses real exit then enter phases with reduced-motion fallback", () => {
  assert.match(motion, /const EXIT_MS = 140/);
  assert.match(motion, /const ENTER_MS = 230/);
  assert.match(motion, /prefers-reduced-motion: reduce/);
  assert.match(motion, /setPhase\("exit"\)/);
  assert.match(motion, /setPhase\("enter"\)/);
  assert.match(motion, /data-motion-phase=\{phase\}/);
  assert.match(globals, /rekixo-admin-panel-out/);
  assert.match(globals, /rekixo-admin-panel-in/);
});

test("Client Admin tab content is motion-swapped without changing status or pricing boundaries", () => {
  assert.match(clientAdmin, /import MotionSwap, \{ MotionToast \} from "\.\/motion-swap";/);
  assert.match(clientAdmin, /<MotionSwap motionKey=\{tab\}>/);
  assert.match(clientAdmin, /<MotionToast message=\{toast\} tone=\{agreementEnabled&&user\.role==="client_admin"\?toastTone:undefined\}\/>/);
  assert.match(clientAdmin, /type:"plotStatus"/);
  assert.match(clientAdmin, /selected&&user\.role==="super_admin"/);
  assert.match(clientAdmin, /user\.role==="client_admin"&&<ClientPlotPricing/);
});

test("Super Admin workspace and project changes use the same motion boundary", () => {
  assert.match(superAdmin, /import MotionSwap, \{ MotionToast \} from "\.\/motion-swap";/);
  assert.match(
    superAdmin,
    /<MotionSwap motionKey=\{`\$\{tab\}:\$\{tab === "clients" \? "clients" : projectId \|\| "none"\}`\}>/,
  );
  assert.match(superAdmin, /<MotionToast message=\{toast\} \/>/);
  assert.match(superAdmin, /<PlotMapper key=\{projectId\} projectId=\{projectId\}/);
});

test("admin micro-interactions avoid transition-all and do not target mapper geometry", () => {
  const marker = globals.indexOf("REKIXO_UI_MOTION_SYSTEM_V1");
  assert.ok(marker >= 0);
  const block = globals.slice(marker);
  assert.doesNotMatch(block, /transition\s*:\s*all/i);
  assert.doesNotMatch(block, /\.mapper-image-wrap\s+svg[^{]*\{/);
  assert.doesNotMatch(block, /\.mapper-point-handle[^{]*\{/);
  assert.match(block, /prefers-reduced-motion:reduce/);
});

test("public customer UI gets entry, modal exit and button micro-interactions while drawer keeps its proven transform flow", () => {
  assert.match(publicPage, /REKIXO_UI_MOTION_SYSTEM_V1/);
  assert.match(publicPage, /@keyframes rekixo-public-shell-in/);
  assert.match(publicPage, /REKIXO_PLOT_DRAWER_LEGACY_RESTORE_V2/);
  assert.match(publicPage, /\.drawer\{position:fixed;[^}]*transform:translateX\(-103%\);transition:\.22s ease;/);
  const publicMotionMarker = publicPage.indexOf("REKIXO_UI_MOTION_SYSTEM_V1");
  const publicMotionBlock = publicPage.slice(publicMotionMarker, publicPage.indexOf("</style>", publicMotionMarker));
  assert.doesNotMatch(publicMotionBlock, /\.drawer\s*\{/);
  assert.doesNotMatch(publicMotionBlock, /\.drawer\.open\s*\{/);
  assert.match(publicPage, /\.gallery-modal\{\s*display:flex;\s*opacity:0;/);
  assert.match(publicPage, /\.image-lightbox\{\s*display:flex;\s*opacity:0;/);
  assert.match(publicPage, /\.gallery-modal\.open\{/);
  assert.match(publicPage, /\.image-lightbox\.open\{/);
  assert.match(publicPage, /prefers-reduced-motion:reduce/);
});

test("public motion block explicitly excludes canonical map transforms", () => {
  const marker = publicPage.indexOf("REKIXO_UI_MOTION_SYSTEM_V1");
  assert.ok(marker >= 0);
  const block = publicPage.slice(marker, publicPage.indexOf("</style>", marker));
  assert.doesNotMatch(block, /\.world[^{]*\{/);
  assert.doesNotMatch(block, /\.master[^{]*\{/);
  assert.doesNotMatch(block, /\.hotspots[^{]*\{/);
  assert.doesNotMatch(block, /\.plot[^{]*\{/);
  assert.doesNotMatch(block, /\.three-host\s+canvas[^{]*\{/);
  assert.doesNotMatch(block, /transition\s*:\s*all/i);
});

test("existing customer plot drawer/gallery JS contracts are unchanged", () => {
  assert.match(publicPage, /drawer\.classList\.add\('open'\)/);
  assert.match(publicPage, /drawer\.classList\.remove\('open'\)/);
  assert.match(publicPage, /galleryModal\.classList\.add\('open'\)/);
  assert.match(publicPage, /galleryModal\.classList\.remove\('open'\)/);
  assert.match(publicPage, /imageLightbox\.classList\.add\('open'\)/);
  assert.match(publicPage, /imageLightbox\.classList\.remove\('open'\)/);
});

test("motion patch does not extend into 3D, mapper data, public API or database schema", () => {
  assert.doesNotMatch(three, /REKIXO_UI_MOTION_SYSTEM_V1|rekixo-motion-swap/);
  assert.doesNotMatch(mapper, /REKIXO_UI_MOTION_SYSTEM_V1|MotionSwap/);
  assert.doesNotMatch(publicApi, /REKIXO_UI_MOTION_SYSTEM_V1/);
  assert.doesNotMatch(schema, /REKIXO_UI_MOTION_SYSTEM_V1/);
});
