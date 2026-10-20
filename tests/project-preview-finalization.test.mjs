import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mapper, superMapper, publicData, publicPage, publishPanel] = await Promise.all([
  readFile(new URL("../app/plot-mapper.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/super-mapper/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public-data/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/project/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/project-publish-panel.tsx", import.meta.url), "utf8"),
]);

test("project-level website rotation is validated and public", () => {
  assert.match(superMapper, /"publicRotation"/);
  assert.match(superMapper, /key === "publicRotation"/);
  assert.match(superMapper, /number < 0 \|\| number > 3/);
  assert.match(publicData, /"publicRotation"/);
});

test("viewing original raster preserves the saved mapping and calibration plane", () => {
  assert.match(mapper, /settingsReady/);
  assert.match(mapper, /naturalImageSize/);
  assert.doesNotMatch(mapper, /metadataRepairRef/);
  assert.doesNotMatch(mapper, /persistMapperSettings\(\{ mapWidth: String\(width\), mapHeight: String\(height\) \}\)/);
  assert.match(mapper, /else params\.set\("variant", "original"\)/);
  assert.match(mapper, /rekixo:mapper-settings-updated/);
});

test("mapper shares presentation rotation while canonical geometry remains unchanged", () => {
  assert.match(mapper, /rekixo:mapper-rotation:\$\{projectId\}/);
  assert.match(mapper, /persistMapperSettings\(\{ publicRotation: String\(next\) \}\)/);
  assert.match(mapper, /Plot polygons always stay in canonical source-image coordinates/);
  assert.match(mapper, /Rotation is presentation metadata only/);
});

test("generic preview cannot flash or bootstrap Tiyansh tenant data", () => {
  assert.match(publicPage, /const REKIXO_GENERIC_BOOT=true/);
  assert.match(publicPage, /rekixo-project-loading/);
  assert.match(publicPage, /const plots = \[\]/);
  assert.match(publicPage, /let CALL_PHONE = '', WHATSAPP_PHONE = '', MAP_URL = ''/);
  assert.doesNotMatch(publicPage, /window\.TIYANSH_PLOTS/);
  assert.doesNotMatch(publicPage, /REKIXO_DEFAULT_PROJECT/);
  assert.doesNotMatch(publicPage, /master\.src='masterplan\.jpg'/);
});

test("generic public map contains the full natural masterplan and keeps rotated hit testing aligned", () => {
  assert.match(publicPage, /function displaySize/);

  // Mobile framing is derived from final displayed geometry. Rotation parity alone
  // never decides panorama mode; image + SVG remain one immutable world.
  assert.match(publicPage, /function isMobilePanorama\(\)/);
  assert.match(publicPage, /const size=displaySize\(\)/);
  assert.match(publicPage, /return size\.w\/Math\.max\(1,size\.h\)>vw\/Math\.max\(1,vh\)/);
  assert.match(
    publicPage,
    /fit = mobile \? Math\.max\(fw,fh\) : containFit/,
  );
  assert.doesNotMatch(
    publicPage,
    /fit = panorama \? fh : \(mobile \? fw : Math\.min\(fw,fh\)\)/,
  );

  // Canonical source dimensions and geometry conversion remain the source of truth.
  assert.match(publicPage, /function rescaleNormalizedPlots/);
  assert.match(publicPage, /master\.naturalWidth/);
  assert.match(publicPage, /publicRotation=normalizeQuarterTurn\(s\.publicRotation\)/);

  // Rotated tap/hit testing still inverts presentation rotation back to source coordinates.
  assert.match(publicPage, /u=rotateOffset\(dx,dy,\(4-publicRotation\)%4\)/);
  assert.match(publicPage, /rotate\(\$\{publicRotation\*90\}deg\)/);
});
test("publish readiness refreshes immediately after mapper metadata repair", () => {
  assert.match(publishPanel, /rekixo:mapper-settings-updated/);
  assert.match(publishPanel, /Publish status refresh nahi hua/);
});
