import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  access,
  rootPage,
  sharedPage,
  mapPage,
  publicData,
  publicGeo,
  publicGeoMasterplan,
  assets,
  gallery,
  shareImage,
  shareMetadata,
] = await Promise.all([
  read("../app/public-site-access.ts"),
  read("../app/page.tsx"),
  read("../app/projects/[slug]/page.tsx"),
  read("../app/projects/[slug]/map/page.tsx"),
  read("../app/api/public-data/route.ts"),
  read("../app/api/public-geo/handler.ts"),
  read("../app/api/public-geo-masterplan/handler.ts"),
  read("../app/api/project-asset/[kind]/route.ts"),
  read("../app/api/gallery/[id]/route.ts"),
  read("../app/projects/[slug]/share-image/[version]/route.ts"),
  read("../app/project-share-metadata.ts"),
]);

test("central public kill switch is default-on and returns a no-store 503", () => {
  assert.match(access, /PUBLIC_SITE_SETTING = "publicSiteEnabled"/);
  assert.match(access, /return row\?\.value !== "0"/);
  assert.match(access, /PROJECT_TEMPORARILY_UNAVAILABLE/);
  assert.match(access, /status: 503/);
  assert.match(access, /"cache-control": "no-store"/);
  assert.match(access, /"retry-after": "60"/);
  assert.match(access, /"x-rekixo-public-access": "disabled"/);
});

test("custom-domain and shared public pages hide customer content while paused", () => {
  assert.match(
    rootPage,
    /target\.role === "public"[\s\S]*publicSiteEnabled\(target\.projectId\)/,
  );
  assert.match(rootPage, /Project Temporarily Unavailable/);

  assert.match(
    sharedPage,
    /if \(!\(await publicSiteEnabled\(project\.id\)\)\)/,
  );
  assert.match(sharedPage, /Project Temporarily Unavailable/);
  // Paused OG metadata was extracted into a shared helper so custom domains
  // and /projects/[slug] cannot accidentally expose published share images.
  assert.match(sharedPage, /generatePublishedProjectMetadata/);
  assert.match(shareMetadata, /paused: true as const/);
  assert.match(shareMetadata, /imageUrl: ""/);
  assert.match(shareMetadata, /logoUrl: ""/);
  assert.match(shareMetadata, /publicSiteEnabled\(project\.id\)/);
});

test("all public data and media endpoints enforce the same kill switch", () => {
  assert.match(
    publicData,
    /!previewId && !\(await publicSiteEnabled\(projectId\)\)/,
  );
  assert.match(
    assets,
    /mode === "public" && !\(await publicSiteEnabled\(projectId\)\)/,
  );
  assert.match(
    gallery,
    /mode === "public" && !\(await publicSiteEnabled\(projectId\)\)/,
  );
  assert.match(
    shareImage,
    /if \(!\(await publicSiteEnabled\(project\.id\)\)\)/,
  );
  assert.match(shareImage, /disabled: true/);
  assert.match(shareImage, /publicSiteUnavailableResponse\(\)/);
  assert.match(shareImage, /publicSiteUnavailableHeaders\(\)/);
});

test("Geo API checks public access before serving its manual edge cache", () => {
  const gate = publicGeo.indexOf("publicSiteEnabled(source.id)");
  const cacheRead = publicGeo.indexOf("cache.match(cacheKey)");
  assert.ok(gate >= 0);
  assert.ok(cacheRead > gate);
  assert.match(publicGeo, /return publicSiteUnavailableResponse\(\)/);

  const masterGate = publicGeoMasterplan.indexOf("publicSiteEnabled(source.id)");
  const masterCacheRead = publicGeoMasterplan.indexOf("cache.match(cacheKey)");
  assert.ok(masterGate >= 0);
  assert.ok(masterCacheRead > masterGate);
  assert.match(
    publicGeoMasterplan,
    /return publicSiteUnavailableResponse\(\)/,
  );
});

test("public Geo page and metadata are unavailable without loading Maps resources", () => {
  const gate = mapPage.indexOf("publicSiteEnabled(project.id)");
  const preconnect = mapPage.indexOf('preconnect("https://maps.googleapis.com")');
  const mapsKey = mapPage.indexOf("publicGoogleMapsBrowserKey()");
  assert.ok(gate >= 0);
  assert.ok(preconnect > gate);
  assert.ok(mapsKey > gate);
  assert.match(mapPage, /Project Temporarily Unavailable/);
});

test("authenticated preview/admin asset access remains intentionally available", () => {
  assert.match(publicData, /Authenticated previews intentionally bypass/);
  assert.match(assets, /if \(mode === "public"/);
  assert.match(assets, /mode === "admin"/);
  assert.match(gallery, /if \(mode === "public"/);
  assert.match(gallery, /mode: "admin"/);
});
