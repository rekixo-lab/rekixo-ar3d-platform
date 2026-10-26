import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generic client shell has no Tiyansh/Raigarh metadata bleed", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /Tiyansh — The Prime Square/);
  assert.doesNotMatch(layout, /Commercial plots in Raigarh/);
  assert.match(layout, /AR 3D Vision Project/);
});

test("canonical shared project path owns project-specific metadata", async () => {
  const [page, metadata, home] = await Promise.all([
    readFile(new URL("../app/projects/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/project-share-metadata.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /generateMetadata/);
  assert.match(page, /generatePublishedProjectMetadata/);
  assert.match(metadata, /shareTitle/);
  assert.match(metadata, /shareDescription/);
  assert.match(metadata, /shareImage/);
  assert.match(page, /projectSlug/);
  assert.match(home, /generatePublishedProjectMetadata/);
});

test("legacy short project path redirects to canonical projects path", async () => {
  const legacy = await readFile(
    new URL("../app/p/[slug]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(legacy, /permanentRedirect/);
  assert.match(legacy, /\/projects\//);
});

test("public API exposes project-scoped share metadata keys", async () => {
  const route = await readFile(
    new URL("../app/api/public-data/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /"shareTitle"/);
  assert.match(route, /"shareDescription"/);
  assert.match(route, /"shareImage"/);
});

test("generic public HTML has no Tiyansh or RPK share metadata defaults", async () => {
  const html = await readFile(
    new URL("../public/project/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /<title>Tiyansh — The Prime Square<\/title>/);
  assert.doesNotMatch(html, /Rekixo RPK share meta start/);
  assert.doesNotMatch(html, /projectName:\s*"Shree Banashankari Nagara"/);
});

test("RPK project data is seeded separately", async () => {
  const migration = await readFile(
    new URL("../drizzle/0007_project_share_metadata.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /shree-banashankari-nagara/);
  assert.match(migration, /\/rpk-share-card\.png/);
  assert.match(migration, /95386 02461/);
});
