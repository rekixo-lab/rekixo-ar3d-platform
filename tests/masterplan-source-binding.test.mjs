import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/api/super-mapper/route.ts", import.meta.url), "utf8");

function fixture() {
  const objects = new Map();
  const settings = new Map([["masterplanOriginalObjectToken", "old_original_token"]]);
  const events = [];
  const statements = [];
  const env = {
    DB: { async batch(items) { return Promise.all(items.map(item => item.run())); }, prepare(sql) {
      statements.push(sql);
      return { bind(...values) { return {
        async first() { return { id: "tenant-a" }; },
        async run() {
          if (sql.startsWith("INSERT INTO settings")) settings.set(values[1], values[2]);
          if (sql.startsWith("DELETE FROM settings")) values.slice(1).forEach(key => settings.delete(key));
          return { success: true };
        },
      }; } };
    } },
    BUCKET: {
      async head(key) { const item = objects.get(key); return item ? { size: item.bytes.length } : null; },
      async put(key, stream, options) {
        events.push(key);
        objects.set(key, { bytes: Buffer.from(await new Response(stream).arrayBuffer()), ...options });
      },
    },
  };
  const imports = {
    "cloudflare:workers": { env },
    "@/modules/auth": { requireSuperAdmin: async () => ({ role: "super_admin" }), sameOrigin: () => true },
    "@/modules/audit": { writeAudit: async () => {} },
    "@/modules/mapper": {},
    "@/modules/plots": {},
    "@/modules/public-publish-snapshot": { freezeCurrentPublishedAssets: async () => events.push("freeze") },
  };
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", javascript)(name => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
    return imports[name];
  }, module.exports, module);
  async function upload({ original, token, originalSize = 5 } = {}) {
    const form = new FormData();
    form.set("projectId", "tenant-a"); form.set("kind", "masterplan");
    form.set("file", new File(["working-image"], "map.webp", { type: "image/webp" }));
    form.set("mapWidth", "2048"); form.set("mapHeight", "1024");
    form.set("originalWidth", "16000"); form.set("originalHeight", "8000");
    if (original !== undefined) form.set("originalFile", new File([original], "boss.png", { type: "image/png" }));
    if (token) {
      form.set("originalUploadCompleted", "1"); form.set("originalObjectToken", token);
      form.set("originalFileName", "boss.png"); form.set("originalFileSize", String(originalSize));
    }
    return module.exports.POST(new Request("https://admin.example.com/api/super-mapper", { method: "POST", body: form }));
  }
  return { objects, settings, events, statements, upload };
}

test("inline original bytes are immutable and bound to the exact working image before settings change", async () => {
  const f = fixture();
  assert.equal((await f.upload({ original: "source-A" })).status, 200);
  const keyA = f.objects.get("projects/tenant-a/mapper/masterplan").customMetadata.masterplanOriginalKey;
  assert.match(keyA, /^projects\/tenant-a\/mapper\/masterplanOriginal\/[a-zA-Z0-9_-]{12,80}$/);
  assert.equal(f.objects.get(keyA).bytes.toString(), "source-A");
  assert.equal(f.settings.get("masterplanOriginalObjectToken"), keyA.split("/").at(-1));
  assert.equal(f.events[0], "freeze");
  assert.equal((await f.upload({ original: "source-B" })).status, 200);
  const keyB = f.objects.get("projects/tenant-a/mapper/masterplan").customMetadata.masterplanOriginalKey;
  assert.notEqual(keyA, keyB);
  assert.equal(f.objects.get(keyA).bytes.toString(), "source-A");
  assert.equal(f.objects.get(keyB).bytes.toString(), "source-B");
  assert.ok(f.statements.every(sql => !/\bplots\b/i.test(sql)), "upload must not mutate geometry or plot status");
});

test("source-less legacy replacement disables stale original lookup", async () => {
  const f = fixture();
  assert.equal((await f.upload()).status, 200);
  assert.equal(f.objects.get("projects/tenant-a/mapper/masterplan").customMetadata.masterplanOriginalKey, "");
  assert.equal(f.settings.has("masterplanOriginalObjectToken"), false);
});

test("multipart source binding retains already uploaded bytes and verifies missing/incorrect source", async () => {
  const f = fixture(), token = "original_token_12345", key = `projects/tenant-a/mapper/masterplanOriginal/${token}`;
  assert.equal((await f.upload({ token })).status, 409);
  f.objects.set(key, { bytes: Buffer.from("EXACT") });
  assert.equal((await f.upload({ token, originalSize: 6 })).status, 409);
  assert.equal((await f.upload({ token, original: "must-not-replace" })).status, 200);
  assert.equal(f.objects.get(key).bytes.toString(), "EXACT");
  assert.equal(f.objects.get("projects/tenant-a/mapper/masterplan").customMetadata.masterplanOriginalKey, key);
  assert.equal(f.settings.get("masterplanOriginalObjectToken"), token);
});
