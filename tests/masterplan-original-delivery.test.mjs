import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const [snapshotSource, routeSource] = await Promise.all([
  readFile(new URL("../app/public-publish-snapshot.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/project-asset/[kind]/route.ts", import.meta.url), "utf8"),
]);

function load(source, dependencies) {
  const exports = {};
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", javascript)((name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function harness() {
  const objects = new Map();
  let tick = 0;
  const state = {
    session: null, enabled: true, token: "original_token_0001", published: true, version: 7,
    originalUpdatedAt: "2026-10-20T12:00:00.000Z", masterplanUpdatedAt: "2026-10-20T12:00:00.000Z",
  };
  const canonical = "projects/a/mapper/masterplan";
  const source = "projects/a/mapper/masterplanOriginal/original_token_0001";
  const published = "projects/a/published/7/masterplan";
  const original = "projects/a/published/7/masterplanOriginal";
  const bucket = {
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const etag = createHash("sha256").update(bytes).digest("hex");
      objects.set(key, {
        bytes, size: bytes.length, etag, httpEtag: `"${etag}"`,
        uploaded: new Date(++tick * 1000),
        httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {},
      });
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { ...value, body: value.bytes.slice() } : null;
    },
    async head(key) {
      const value = objects.get(key);
      return value ? { ...value } : null;
    },
    async delete(key) { objects.delete(key); },
  };
  const env = {
    BUCKET: bucket,
    DB: {
      prepare(query) {
        return { bind(projectId) {
          return { async first() {
            if (projectId !== "a") return null;
            if (query.includes("masterplanOriginalObjectToken")) return { value: state.token, updatedAt: state.originalUpdatedAt };
            if (query.includes("masterplanVersion")) return { value: "1234567", updatedAt: state.masterplanUpdatedAt };
            if (query.includes("public_status AS")) return { publicStatus: state.published ? "published" : "draft", publishVersion: state.version };
            if (query.includes("SELECT id FROM projects")) return { id: "a" };
            return null;
          } };
        } };
      },
    },
  };
  const snapshot = load(snapshotSource, { "cloudflare:workers": { env } });
  const route = load(routeSource, {
    "cloudflare:workers": { env },
    "@/modules/auth": { getAdminSession: async () => state.session },
    "@/modules/projects": { publicProjectId: async () => state.published ? "a" : null },
    "@/modules/public-publish-snapshot": snapshot,
    "@/modules/public-site-access": {
      publicSiteEnabled: async () => state.enabled,
      publicSiteUnavailableResponse: () => new Response("Unavailable", { status: 503 }),
    },
  });
  return {
    state, bucket, objects, snapshot, canonical, source, published, original,
    get: (query = "variant=original&v=7", kind = "masterplan") => route.GET(
      new Request(`https://example.test/api/project-asset/${kind}?projectId=a&${query}`),
      { params: Promise.resolve({ kind }) },
    ),
  };
}

async function seed(h, { bound = true } = {}) {
  await h.bucket.put(h.source, "UNCHANGED original image bytes", { httpMetadata: { contentType: "image/png" } });
  await h.bucket.put(h.canonical, "working webp", {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: bound ? { masterplanOriginalKey: h.source } : {},
  });
  await h.bucket.put("projects/a/mapper/masterplanPublic", "small preview");
}

test("publishing captures the exact original bytes and public delivery is inline", async () => {
  const h = harness();
  await seed(h);
  await h.snapshot.promotePublishedAssets("a", 7);
  const response = await h.get();
  assert.equal(await response.text(), "UNCHANGED original image bytes");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(response.headers.get("x-rekixo-masterplan-source"), "published-original");
  assert.equal(response.headers.get("x-rekixo-publish-asset"), "snapshot");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.equal(h.objects.get(h.published).customMetadata.masterplanOriginalKey, h.source);
});

test("read-only original provenance probe uses the published resolver and never sends image bytes", async () => {
  const h = harness();
  await seed(h);
  await h.snapshot.promotePublishedAssets("a", 7);
  const probe = await h.get("variant=original&v=7&inspect=1");
  assert.equal(probe.status, 200);
  assert.match(probe.headers.get("content-type"), /application\/json/);
  assert.equal(probe.headers.get("cache-control"), "no-store");
  assert.equal(probe.headers.get("x-content-type-options"), "nosniff");
  const metadata = await probe.json();
  assert.equal(metadata.original, true);
  assert.equal(metadata.source, "published-original");
  assert.equal(metadata.bytes, new TextEncoder().encode("UNCHANGED original image bytes").length);
  assert.equal(JSON.stringify(metadata).includes("projects/"), false, "do not leak R2 object keys");
});

test("compressed original fallback is accurately labelled and must never be immutably cached", async () => {
  const h = harness();
  await seed(h);
  await h.bucket.delete(h.source);
  await h.snapshot.promotePublishedAssets("a", 7);
  const probe = await h.get("variant=original&v=7&inspect=1");
  assert.deepEqual((await probe.json()).original, false);
  const response = await h.get("variant=original&v=7&fidelity=original-v2");
  assert.equal(await response.text(), "working webp");
  assert.equal(response.headers.get("x-rekixo-original-fidelity"), "optimized-fallback");
  assert.equal(response.headers.get("x-rekixo-masterplan-source"), "published-canonical-fallback");
  assert.doesNotMatch(response.headers.get("cache-control"), /immutable/);
});

test("legacy compatible originals are never stuck in immutable browser cache", async () => {
  const h = harness();
  await seed(h, { bound: false });
  await h.bucket.put(h.published, "working webp");
  const probe = await h.get("variant=original&v=7&inspect=1");
  assert.equal((await probe.json()).original, true);
  const original = await h.get();
  assert.equal(original.headers.get("x-rekixo-masterplan-source"), "published-original-compatible");
  assert.equal(original.headers.get("x-rekixo-original-fidelity"), "original");
  assert.doesNotMatch(original.headers.get("cache-control"), /immutable/);
});

test("freezing before a replacement preserves the old public original", async () => {
  const h = harness();
  await seed(h);
  await h.snapshot.freezeCurrentPublishedAssets("a", ["masterplan"]);
  await h.bucket.put(h.canonical, "DRAFT replacement", { customMetadata: { masterplanOriginalKey: "projects/a/mapper/masterplanOriginal/new_original_0002" } });
  await h.bucket.put("projects/a/mapper/masterplanOriginal/new_original_0002", "PRIVATE new original");
  h.state.token = "new_original_0002";
  assert.equal(await (await h.get()).text(), "UNCHANGED original image bytes");
});

test("an existing project's matching frozen working image permits its original", async () => {
  const h = harness();
  await seed(h, { bound: false });
  await h.bucket.put(h.published, "working webp");
  const response = await h.get();
  assert.equal(await response.text(), "UNCHANGED original image bytes");
  assert.equal(response.headers.get("x-rekixo-masterplan-source"), "published-original-compatible");
});

test("a draft source never replaces an older frozen public masterplan", async () => {
  const h = harness();
  await seed(h);
  await h.bucket.put(h.published, "OLDER frozen masterplan");
  const response = await h.get();
  assert.equal(await response.text(), "OLDER frozen masterplan");
  assert.equal(response.headers.get("x-rekixo-masterplan-source"), "published-canonical-fallback");
  await h.snapshot.freezeCurrentPublishedAssets("a", ["masterplan"]);
  assert.equal(h.objects.has(h.original), false, "freezing must not label a draft source as published");
});

test("missing provenance fails closed instead of exposing a current draft original", async () => {
  const h = harness();
  await seed(h);
  assert.equal((await h.get()).status, 404);
});

test("explicitly absent source bindings do not revive stale source pointers", async () => {
  const h = harness();
  await seed(h);
  await h.bucket.put(h.canonical, "source-less image", { customMetadata: { masterplanOriginalKey: "" } });
  await h.bucket.put(h.original, "ORPHAN from failed publish");
  await h.snapshot.promotePublishedAssets("a", 7);
  assert.equal(h.objects.has(h.original), false);
  assert.equal(await (await h.get()).text(), "source-less image");
});

test("bound original keys cannot cross project boundaries", async () => {
  const h = harness();
  await seed(h);
  await h.bucket.put(h.canonical, "tenant a working", { customMetadata: { masterplanOriginalKey: "projects/b/mapper/masterplanOriginal/other_token_0001" } });
  await h.bucket.put("projects/b/mapper/masterplanOriginal/other_token_0001", "TENANT B private source");
  h.state.session = { role: "super_admin" };
  const response = await h.get("variant=original&preview=1");
  assert.equal(await response.text(), "tenant a working");
});

test("authenticated Super Admin original preview is current and never cached", async () => {
  const h = harness();
  await seed(h);
  h.state.published = false;
  h.state.session = { role: "super_admin" };
  const response = await h.get("variant=original&preview=1");
  assert.equal(await response.text(), "UNCHANGED original image bytes");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-rekixo-access-mode"), "admin");
  h.state.session = null;
  assert.equal((await h.get("variant=original&preview=1")).status, 404);
});

test("public original ignores unrelated admin cookies and honors version and kill switch", async () => {
  const h = harness();
  await seed(h);
  await h.snapshot.promotePublishedAssets("a", 7);
  h.state.session = { role: "client_admin", projectId: "b" };
  assert.equal((await h.get()).status, 200);
  assert.equal((await h.get("variant=original&v=6")).status, 409);
  h.state.enabled = false;
  assert.equal((await h.get()).status, 503);
  h.state.enabled = true;
  h.state.session = null;
  assert.equal((await h.get("", "masterplanOriginal")).status, 404);
});

test("a missing bound original falls back to canonical and never an older stable original", async () => {
  const h = harness();
  await seed(h);
  await h.bucket.delete(h.source);
  await h.bucket.put("projects/a/mapper/masterplanOriginal", "UNRELATED older original");
  await h.snapshot.promotePublishedAssets("a", 7);
  assert.equal(await (await h.get()).text(), "working webp");
});

test("legacy compatibility rechecks object identity after settings lookup", async () => {
  const h = harness();
  await seed(h, { bound: false });
  await h.bucket.put(h.published, "working webp");
  const originalHead = h.bucket.head.bind(h.bucket);
  let canonicalReads = 0;
  h.bucket.head = async (key) => {
    if (key === h.canonical && ++canonicalReads === 2) {
      await h.bucket.put(h.canonical, "working webp", { customMetadata: { masterplanOriginalKey: "projects/a/mapper/masterplanOriginal/new_source_0002" } });
    }
    return originalHead(key);
  };
  assert.equal(await h.snapshot.compatiblePublishedMasterplanOriginalKey("a", 7), null);
});

test("legacy original settings left behind by a newer source-less upload are rejected", async () => {
  const h = harness();
  await seed(h, { bound: false });
  await h.bucket.put(h.published, "working webp");
  h.state.masterplanUpdatedAt = "2026-10-20T13:00:00.000Z";
  assert.equal(await (await h.get()).text(), "working webp");
  assert.equal(await h.snapshot.currentMasterplanOriginalKey("a", await h.bucket.head(h.canonical)), null);
});

test("legacy stable originals require upload-time provenance rather than mere existence", async () => {
  const h = harness();
  await seed(h, { bound: false });
  h.state.token = "";
  const stable = "projects/a/mapper/masterplanOriginal";
  await h.bucket.put(stable, "legacy original");
  assert.equal(await h.snapshot.currentMasterplanOriginalKey("a", await h.bucket.head(h.canonical)), stable);
  h.objects.get(stable).uploaded = new Date("2020-01-01");
  assert.equal(await h.snapshot.currentMasterplanOriginalKey("a", await h.bucket.head(h.canonical)), null);
});

test("identical draft working bytes cannot disclose a different unpublished original", async () => {
  const h = harness();
  await seed(h, { bound: false });
  await h.bucket.put(h.published, "working webp");
  const draftKey = "projects/a/mapper/masterplanOriginal/draft_source_0002";
  await h.bucket.put(draftKey, "PRIVATE detail absent from the downsampled working image");
  await h.bucket.put(h.canonical, "working webp", { customMetadata: { masterplanOriginalKey: draftKey } });
  h.state.token = "draft_source_0002";
  assert.equal(await h.snapshot.compatiblePublishedMasterplanOriginalKey("a", 7), null);
  assert.equal(await (await h.get()).text(), "working webp");
});

test("a frozen working binding resolves its own original while a newer draft is edited", async () => {
  const h = harness();
  await seed(h);
  await h.bucket.put(h.published, "working webp", { customMetadata: { masterplanOriginalKey: h.source } });
  const draftKey = "projects/a/mapper/masterplanOriginal/draft_source_0002";
  await h.bucket.put(draftKey, "PRIVATE draft original");
  await h.bucket.put(h.canonical, "new draft working", { customMetadata: { masterplanOriginalKey: draftKey } });
  assert.equal(await (await h.get()).text(), "UNCHANGED original image bytes");
});
