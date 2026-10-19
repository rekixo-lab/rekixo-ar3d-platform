import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Super Admin exposes an explicit Project Assets workspace", async () => {
  const [dashboard, manager] = await Promise.all([
    source("../app/super-admin-dashboard.tsx"),
    source("../app/project-assets-manager.tsx"),
  ]);

  assert.match(dashboard, /"assets"/);
  assert.match(dashboard, /<Archive \/> Project Assets/);
  assert.match(dashboard, /ProjectAssetsManager/);
  assert.match(dashboard, /tab !== "assets"/);
  assert.match(manager, /Download Full Project ZIP/);
  assert.match(manager, /includeLinkedGeoLab/);
  assert.match(manager, /\/api\/admin\/project-assets\/download/);
  assert.match(manager, /for \(const item of manifest\?\.missing \|\| \[\]\)/);
  assert.match(manager, /if \(!groups\.has\(item\.section\)\) groups\.set\(item\.section, \[\]\)/);
});

test("project asset APIs are Super Admin only and require explicit project selection", async () => {
  const [manifestRoute, downloadRoute] = await Promise.all([
    source("../app/api/admin/project-assets/route.ts"),
    source("../app/api/admin/project-assets/download/route.ts"),
  ]);

  for (const route of [manifestRoute, downloadRoute]) {
    assert.match(route, /requireSuperAdmin/);
    assert.match(route, /searchParams\.get\("projectId"\)/);
    assert.match(route, /Project required/);
    assert.doesNotMatch(route, /tiyansh-prime-square/);
  }

  assert.match(downloadRoute, /content-type": "application\/zip"/);
  assert.match(downloadRoute, /content-disposition/);
  assert.match(downloadRoute, /private,no-store/);
  assert.match(downloadRoute, /projectAssetZipStream/);
});

test("export captures canonical D1 recovery datasets and current published state", async () => {
  const exporter = await source("../app/project-assets-export.ts");

  for (const table of [
    "plots",
    "plot_edge_measurements",
    "plot_pricing",
    "plot_admin_details",
    "settings",
    "project_domains",
    "gallery",
    "project_memberships",
    "project_3d_links",
    "project_public_snapshots",
    "published_plots",
    "published_plot_edge_measurements",
    "published_settings",
    "geo_project_settings",
    "geo_control_points",
    "geo_features",
    "geo_sources",
    "geo_versions",
  ]) {
    assert.ok(exporter.includes(table), `missing export source: ${table}`);
  }

  assert.match(exporter, /05-published\/snapshot\.json/);
  assert.match(exporter, /const publishedPrefix = `projects\/\$\{projectId\}\/published\/\$\{version\}\/`/);
  assert.match(exporter, /kind: "masterplan"/);
  assert.match(exporter, /Published share card/);
  assert.match(exporter, /Canonical pricing/);
  assert.match(exporter, /Plot edge measurements/);
  assert.match(exporter, /01-project-data\/private-plot-details/);
  assert.match(exporter, /booking_amount_paise AS bookingAmountPaise/);
  assert.match(exporter, /plotAdminDetails: plotAdminDetails\.length/);
});

test("export includes current mapper, branding, gallery and Geo binaries without sweeping R2 prefixes", async () => {
  const exporter = await source("../app/project-assets-export.ts");

  for (const asset of [
    "masterplanOriginal",
    "masterplanPublic",
    "sourcePdf",
    "sourceCad",
    "cadGeometry",
    "plotSheet",
    "measurementSheet",
    "roadAccessSheet",
    "sideMappingSheet",
    "share/card",
    "share/source",
  ]) {
    assert.ok(exporter.includes(asset), `missing asset contract: ${asset}`);
  }

  assert.match(exporter, /gallery\/images/);
  assert.match(exporter, /geo\/sources/);
  assert.match(exporter, /geoPublicManifestKey/);
  assert.match(exporter, /validR2Key/);
  assert.doesNotMatch(exporter, /BUCKET\.list\s*\(/);
});

test("project export remains read-only and excludes credential material", async () => {
  const exporter = await source("../app/project-assets-export.ts");

  assert.doesNotMatch(exporter, /BUCKET\.(?:put|delete)\s*\(/);
  assert.doesNotMatch(exporter, /\.batch\s*\(/);
  assert.doesNotMatch(exporter, /\.run\s*\(/);

  const adminQuery = exporter.match(
    /"SELECT id,email,login_type AS loginType[\s\S]*?FROM admin_users WHERE project_id=\? ORDER BY created_at,id"/,
  );
  assert.ok(adminQuery, "sanitized admin metadata query missing");
  assert.doesNotMatch(adminQuery[0], /password_hash|password_salt|session_version/);

  assert.match(exporter, /credentialMaterialExcluded: true/);
  assert.match(exporter, /excludedSensitiveData/);
  assert.match(exporter, /AR3D Engine binary models\/scenes\/textures/);
});


test("masterplan ready and source PDF export exact original stored bytes without ZIP compression", async () => {
  const [exporter, manager] = await Promise.all([
    source("../app/project-assets-export.ts"),
    source("../app/project-assets-manager.tsx"),
  ]);

  assert.match(exporter, /Masterplan Ready — ORIGINAL \/ NO COMPRESSION/);
  assert.match(exporter, /Source PDF — ORIGINAL \/ NO COMPRESSION/);
  assert.match(exporter, /preferred: values\.sourcePdfName \|\| "source-plan\.pdf"/);
  assert.match(exporter, /head\.customMetadata\?\.filename/);
  assert.match(exporter, /head\.customMetadata\?\.expectedSize/);
  assert.match(exporter, /byteFidelity: "original-upload"/);
  assert.match(exporter, /zipMode: "streaming-store"/);
  assert.match(exporter, /u16\(0\),\s*\/\/ compression method|u16\(0\),/);
  assert.match(exporter, /object\.body\.getReader\(\)/);
  assert.doesNotMatch(exporter, /CompressionStream/);

  assert.match(manager, /EXACT ORIGINAL BYTES · NO ZIP COMPRESSION/);
  assert.match(manager, /byteFidelity === "original-upload"/);
});

test("ZIP is streamed with backpressure instead of buffering project binaries", async () => {
  const exporter = await source("../app/project-assets-export.ts");

  assert.match(exporter, /async function\* zipChunks/);
  assert.match(exporter, /object\.body\.getReader\(\)/);
  assert.match(exporter, /new ReadableStream<Uint8Array>/);
  assert.match(exporter, /async pull\(controller\)/);
  assert.match(exporter, /dataDescriptor/);
  assert.match(exporter, /centralHeader/);
  assert.doesNotMatch(exporter, /object\.arrayBuffer\(\)/);
  assert.doesNotMatch(exporter, /new Blob\(/);
});

test("linked Geo Lab is opt-in and normal project export does not silently merge tenants", async () => {
  const exporter = await source("../app/project-assets-export.ts");

  assert.match(exporter, /includeLinkedGeoLab/);
  assert.match(exporter, /kind='geo_lab'/);
  assert.match(
    exporter,
    /full working workspace is not included unless the advanced option is enabled/i,
  );
  assert.match(exporter, /allowedGeoPrefixes/);
  assert.match(exporter, /outside the selected\/linked project safety boundary/);
});
