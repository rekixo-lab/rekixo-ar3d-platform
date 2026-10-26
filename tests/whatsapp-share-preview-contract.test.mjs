import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Share Builder recognizes numeric snapshot versions and rejects unsynced drafts", async () => {
  const api = await source("../app/api/admin/project-share/route.ts");

  assert.ok(api.includes(String.raw`/^\d{1,20}$/.test(publishedShareVersion)`));
  assert.ok(!api.includes(String.raw`/^\\d{1,20}$/.test(publishedShareVersion)`));
  assert.match(api, /publishedShareVersion === shareVersion/);
  assert.match(api, /publishedShareImageValue === String\(settings\.shareImage \|\| ""\)\.trim\(\)/);
  assert.match(api, /const linkVersion = publishedSnapshotReady \? publishedShareVersion : shareVersion/);
  assert.equal(/^\d{1,20}$/.test("1799999999999"), true);
});

test("Both public project URLs use published-only Open Graph image metadata", async () => {
  const [home, page, metadata] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/projects/[slug]/page.tsx"),
    source("../app/project-share-metadata.ts"),
  ]);
  assert.match(home, /export async function generateMetadata/);
  assert.match(home, /target\?\.role !== "public"/);
  assert.match(home, /generatePublishedProjectMetadata\(project\.slug\)/);
  assert.match(page, /generatePublishedProjectMetadata\(slug\)/);
  assert.match(metadata, /published_settings/);
  assert.match(metadata, /\/api\/project-asset\/shareCard\?/);
  assert.match(metadata, /&public=1/);
  assert.match(metadata, /images,?/);
  assert.match(metadata, /openGraph:/);
  assert.match(metadata, /twitter:/);
});

test("Share images are JPEG, size bounded, not cropped and publicly fetchable", async () => {
  const [manager, asset] = await Promise.all([
    source("../app/project-share-manager.tsx"),
    source("../app/api/project-asset/[kind]/route.ts"),
  ]);

  const socialEncoder = manager.slice(
    manager.indexOf("async function prepareBrandedShareImage"),
    manager.indexOf("export default function ProjectShareManager"),
  );
  assert.ok(socialEncoder.includes('return new File([blob], "share-branded.jpg"'));
  assert.ok(socialEncoder.includes('canvasBlob(outputCanvas, "image/jpeg", quality)'));
  assert.ok(!socialEncoder.includes('canvasBlob(outputCanvas, "image/webp"'));
  assert.ok(socialEncoder.includes("MAX_WHATSAPP_SHARE_IMAGE_BYTES"));
  assert.ok(socialEncoder.includes("scaledContext.drawImage(canvas, 0, 0"));
  assert.ok(socialEncoder.includes("context.drawImage(sourceBitmap, 0, 0, width, height)"));

  assert.ok(asset.includes('headers.set("content-disposition", "inline")'));
  assert.ok(asset.includes('headers.set("content-length", String(object.size))'));
  assert.ok(asset.includes('headers.set("cross-origin-resource-policy", "cross-origin")'));
  assert.ok(asset.includes('headers.set("access-control-allow-origin", "*")'));
});

test("Link preview tags stay in HTML head for unrecognized crawler agents", async () => {
  const [config, metadata] = await Promise.all([
    source("../next.config.ts"),
    source("../app/project-share-metadata.ts"),
  ]);
  assert.match(config, /htmlLimitedBots:\\s*\/\.\*\//);
  assert.match(metadata, /canonicalShareUrl/);
  assert.match(metadata, /url: meta\.canonicalShareUrl \|\| undefined/);
  assert.match(metadata, /settings\.shareVersion/);
  assert.match(metadata, /isPlatformAccessHost\(host\)/);
});
