import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("publish readiness still requires share metadata and a saved share image", async () => {
  const [publishRoute, assetRoute, panel] = await Promise.all([
    readFile(new URL("../app/api/admin/publish/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/project-asset/[kind]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/project-publish-panel.tsx", import.meta.url), "utf8"),
  ]);

  assert.ok(publishRoute.includes("shareTitle"));
  assert.ok(publishRoute.includes("Share title required"));
  assert.ok(publishRoute.includes("Share description required"));
  assert.ok(publishRoute.includes("Share preview image required"));
  assert.ok(assetRoute.includes('"masterplan", "logo", "shareCard"'));
  assert.ok(assetRoute.includes("/share/card"));
  assert.ok(assetRoute.includes('object.httpMetadata?.contentType'));
  assert.ok(panel.includes("rekixo:share-profile-updated"));
});

test("Open Graph uses the versioned public share asset endpoint without fake dimensions", async () => {
  const [page, metadata] = await Promise.all([
    readFile(new URL("../app/projects/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/project-share-metadata.ts", import.meta.url), "utf8"),
  ]);

  assert.ok(page.includes("generatePublishedProjectMetadata(slug)"));
  assert.ok(metadata.includes("hasShareImage"));
  assert.ok(metadata.includes('const images = meta.imageUrl'));
  assert.ok(metadata.includes('{ url: meta.imageUrl, alt: meta.title }'));
  assert.ok(metadata.includes("/api/project-asset/shareCard?"));
  assert.ok(metadata.includes("project.id"));
  assert.ok(metadata.includes("settings.shareVersion"));
  assert.ok(metadata.includes("&public=1"));
  assert.ok(!metadata.includes("/share-image/"));
  assert.ok(!metadata.includes("width: 1200"));
  assert.ok(!metadata.includes("height: 630"));
  assert.ok(metadata.includes("icons: meta.logoUrl"));
  assert.ok(metadata.includes('card: meta.hasShareImage ? "summary_large_image" : "summary"'));
});
