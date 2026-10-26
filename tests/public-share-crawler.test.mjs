import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Open Graph share image uses the versioned public asset API", async () => {
  const [page, metadata] = await Promise.all([
    readFile(new URL("../app/projects/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/project-share-metadata.ts", import.meta.url), "utf8"),
  ]);

  assert.ok(page.includes("generatePublishedProjectMetadata(slug)"));
  assert.ok(metadata.includes("'shareVersion'"));
  assert.ok(metadata.includes("/api/project-asset/shareCard?"));
  assert.ok(metadata.includes("project.id"));
  assert.ok(metadata.includes("settings.shareVersion"));
  assert.ok(metadata.includes("&public=1"));
  assert.ok(metadata.includes("versioned R2"));
  assert.ok(!metadata.includes("/share-image/"));
});

test("legacy public share-image route remains session-free, GET+HEAD capable and immutable", async () => {
  const route = await readFile(
    new URL(
      "../app/projects/[slug]/share-image/[version]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(route.includes("projectBySlug(slug)"));
  assert.ok(route.includes("export async function GET"));
  assert.ok(route.includes("export async function HEAD"));
  assert.ok(route.includes('"content-length"'));
  assert.ok(route.includes('"content-disposition": "inline"'));
  assert.ok(route.includes("public,max-age=31536000,immutable"));
  assert.ok(route.includes('"access-control-allow-origin": "*"'));
  assert.ok(!route.includes("getAdminSession"));
  assert.ok(!route.includes("projectId="));
});

test("share uploads persist immutable versioned R2 snapshots plus canonical fallback", async () => {
  const route = await readFile(
    new URL("../app/api/admin/project-share/route.ts", import.meta.url),
    "utf8",
  );

  assert.ok(route.includes("share/cards/${version}"));
  assert.ok(route.includes("share/card"));
  assert.ok(route.includes("file.arrayBuffer()"));
  assert.ok(route.includes("sourceFile.arrayBuffer()"));
  assert.ok(route.includes('source: "ar3d-branded-derivative"'));
  assert.ok(route.includes("share/source"));
  assert.ok(route.includes("share/sources/${version}"));
  assert.ok(route.includes('source: "original-upload"'));
  assert.ok(route.includes("MAX_PUBLIC_SHARE_IMAGE_BYTES"));
  assert.ok(route.includes("550 * 1024"));
  assert.ok(route.includes("MAX_SOURCE_IMAGE_BYTES"));
});

test("shared platform explicit project selectors win before exact-domain fallback", async () => {
  const context = await readFile(
    new URL("../app/project-context.ts", import.meta.url),
    "utf8",
  );

  const platformIndex = context.indexOf("if (isPlatformAccessHost(host))");
  const exactIndex = context.indexOf("const domain = await exactDomain(host)");

  assert.ok(platformIndex >= 0);
  assert.ok(exactIndex > platformIndex);
  assert.ok(context.includes("requestedId"));
  assert.ok(context.includes("requestedSlug"));
});

test("Share Builder exposes readiness from the published snapshot, not only draft/live settings", async () => {
  const [manager, route] = await Promise.all([
    readFile(
      new URL("../app/project-share-manager.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/admin/project-share/route.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(manager, /publishedSnapshotReady/);
  assert.match(manager, /const canCopyShare/);
  assert.match(manager, /Publish Update required/);
  assert.match(manager, /Publish Update ke baad WhatsApp share link ready hoga/);

  assert.match(route, /publishedShareVersion/);
  assert.match(route, /publishedShareImage/);
  assert.match(route, /publishedSnapshotReady/);
  assert.match(route, /snapshotVersion/);
  assert.match(route, /currentVersion/);
  assert.match(route, /publishedSnapshot\.snapshotVersion/);
  assert.match(route, /publishedSnapshot\.currentVersion/);
});
