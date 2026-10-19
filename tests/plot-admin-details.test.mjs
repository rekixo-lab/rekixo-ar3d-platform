import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [helperSource, routeSource, migration] = await Promise.all([
  read("../app/plot-admin-details.ts"),
  read("../app/api/client/plot-details/route.ts"),
  read("../drizzle/0036_rekixo_plot_admin_details.sql"),
]);
function load(source, imports = {}) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleUnderTest = { exports: {} };
  new Function("require", "exports", "module", javascript)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
    return imports[name];
  }, moduleUnderTest.exports, moduleUnderTest);
  return moduleUnderTest.exports;
}
const helpers = load(helperSource);

test("booking amount parses exact decimal rupees and preserves empty versus zero", () => {
  for (const [input, expected] of [[null, null], [" ", null], ["0", 0], ["0.01", 1],
    ["0.29", 29], ["50000", 5_000_000], ["10000000000.00", 1_000_000_000_000]]) {
    assert.deepEqual(helpers.parseBookingAmount(input), { ok: true, value: expected });
  }
  for (const input of [0, {}, [], "-1", "+1", "1e3", "NaN", "Infinity", "1,000", "0.001", "10000000000.01"])
    assert.equal(helpers.parseBookingAmount(input).ok, false, String(input));
  for (const paise of [0, 1, 29, 100, 12345, 1_000_000_000_000])
    assert.equal(helpers.parseBookingAmount(helpers.bookingAmountInput(paise)).value, paise);
});

test("patch accepts Unicode names, explicit clears and only known partial fields", () => {
  assert.deepEqual(helpers.validatePlotAdminDetailsPatch({
    plotId: " 24 ", expectedRevision: 3,
    changes: { ownerName: "  अमित शर्मा  ", bookingAmount: "0.29", brokerName: " " },
  }), { ok: true, value: {
    plotId: "24", expectedRevision: 3,
    changes: { ownerName: "अमित शर्मा", bookingAmountPaise: 29, brokerName: null },
  } });
  assert.deepEqual(helpers.validatePlotAdminDetailsPatch({
    plotId: "24", expectedRevision: 0, changes: { ownerName: null },
  }).value.changes, { ownerName: null });
  assert.equal(helpers.validatePlotAdminDetailsPatch({
    plotId: "24", expectedRevision: 0, changes: { ownerName: "🌻".repeat(120) },
  }).ok, true);
  for (const invalid of [null, [], {},
    { plotId: "24", expectedRevision: 0, projectId: "other", changes: { ownerName: "X" } },
    { plotId: "24", expectedRevision: 0, changes: {} },
    { plotId: "24", expectedRevision: 0, changes: { status: "sold" } },
    { plotId: "24", expectedRevision: 0, changes: { bookingAmountPaise: 1 } },
    { plotId: "24", expectedRevision: "0", changes: { ownerName: "X" } },
    { plotId: "24", expectedRevision: -1, changes: { ownerName: "X" } },
    { plotId: "24", expectedRevision: 0.5, changes: { ownerName: "X" } },
    { plotId: "24", expectedRevision: 0, changes: { ownerName: "x".repeat(121) } },
    { plotId: "24", expectedRevision: 0, changes: { ownerName: "name\u0000" } },
  ]) assert.equal(helpers.validatePlotAdminDetailsPatch(invalid).ok, false);
});

function fixture({ session, originAllowed = true, auditFails = false, businessWriteFails = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE plots(project_id TEXT,id TEXT,sqft REAL,polygon TEXT,status TEXT,
      inventory_active INTEGER,updated_at TEXT,PRIMARY KEY(project_id,id));
    INSERT INTO projects VALUES('tenant-a','active'),('tenant-b','active');
    INSERT INTO plots VALUES
      ('tenant-a','24',1250,'[[0,0],[1,0],[1,1]]','booked',1,'original'),
      ('tenant-a','25',900,'[]','available',0,'inactive'),
      ('tenant-b','99',700,'[]','sold',1,'other');
  `);
  const originalPlots = JSON.stringify(db.prepare("SELECT * FROM plots ORDER BY project_id,id").all());
  db.exec(migration);
  const audits = [];
  const route = load(routeSource, {
    "cloudflare:workers": { env: { DB: {
      prepare(sql) {
        return { bind(...values) { return {
          async first() {
            if (businessWriteFails && /INSERT INTO plot_admin_details|UPDATE plot_admin_details/.test(sql))
              throw new Error("Injected business write failure");
            return db.prepare(sql).get(...values) ?? null;
          },
        }; } };
      },
    } } },
    "@/modules/auth": {
      sameOrigin: () => originAllowed,
      validAdminSession: async () => session === undefined
        ? { id: "admin-a", role: "client_admin", projectId: "tenant-a", email: "a@example.com" } : session,
    },
    "@/modules/audit": { writeAudit: async (...args) => {
      if (auditFails) throw new Error("Injected audit failure");
      audits.push(args);
    } },
    "@/app/plot-admin-details": helpers,
  });
  const patch = async (body) => {
    const response = await route.PATCH(new Request("https://admin.example.com/api/client/plot-details", {
      method: "PATCH", headers: { "content-type": "application/json", origin: "https://admin.example.com" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
  };
  return { db, originalPlots, audits, patch };
}

test("additive migration preserves every old plot and restricts private row deletion and invalid money", () => {
  const { db, originalPlots } = fixture();
  try {
    db.exec(migration); // Reapplying is harmless and old projects need no backfill.
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM plots ORDER BY project_id,id").all()), originalPlots);
    assert.equal(db.prepare("SELECT count(*) n FROM plot_admin_details").get().n, 0);
    const insert = db.prepare(`INSERT INTO plot_admin_details
      (project_id,plot_id,booking_amount_paise,revision,updated_at,updated_by) VALUES(?,?,?,?,?,?)`);
    for (const value of [-1, 0.5, 1_000_000_000_001])
      assert.throws(() => insert.run("tenant-a", "24", value, 1, "now", "admin"), /CHECK/);
    assert.throws(() => insert.run("tenant-a", "missing", 0, 1, "now", "admin"), /FOREIGN KEY/);
    insert.run("tenant-a", "24", 0, 1, "now", "admin");
    assert.throws(() => db.prepare("DELETE FROM plots WHERE project_id='tenant-a' AND id='24'").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE plots SET id='changed' WHERE project_id='tenant-a' AND id='24'").run(), /FOREIGN KEY/);
  } finally { db.close(); }
});

test("API persists canonical details, preserves omitted fields and clears explicitly without touching old plots", async () => {
  const { db, originalPlots, audits, patch } = fixture();
  try {
    const created = await patch({ plotId: "24", expectedRevision: 0,
      changes: { ownerName: " अमित शर्मा ", bookingAmount: "50000.29", brokerName: "राज वर्मा" } });
    assert.equal(created.status, 200);
    assert.equal(created.cache, "private, no-store");
    assert.equal(created.body.details.ownerName, "अमित शर्मा");
    assert.equal(created.body.details.bookingAmountPaise, 5_000_029);
    assert.equal(created.body.details.revision, 1);
    assert.ok(created.body.details.updatedAt);
    const edited = await patch({ plotId: "24", expectedRevision: 1, changes: { brokerName: "नई एजेंसी" } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.details.ownerName, "अमित शर्मा");
    assert.equal(edited.body.details.bookingAmountPaise, 5_000_029);
    assert.equal(edited.body.details.revision, 2);
    const cleared = await patch({ plotId: "24", expectedRevision: 2,
      changes: { ownerName: "", bookingAmount: null, brokerName: null } });
    assert.equal(cleared.status, 200);
    assert.deepEqual({ ...cleared.body.details, updatedAt: null }, {
      ownerName: null, bookingAmountPaise: null, brokerName: null, revision: 3, updatedAt: null,
    });
    assert.equal(db.prepare("SELECT currency FROM plot_admin_details").get().currency, "INR");
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM plots ORDER BY project_id,id").all()), originalPlots);
    assert.deepEqual(audits[0][4].fields, ["ownerName", "bookingAmount", "brokerName"]);
    assert.doesNotMatch(JSON.stringify(audits), /अमित|वर्मा|5000029/);
  } finally { db.close(); }
});

test("concurrent first saves and edits conflict instead of overwriting private details", async () => {
  const { db, patch } = fixture();
  try {
    const first = await Promise.all(["First", "Second"].map((ownerName) => patch({
      plotId: "24", expectedRevision: 0, changes: { ownerName },
    })));
    assert.deepEqual(first.map((r) => r.status).sort(), [200, 409]);
    const current = first.find((r) => r.status === 200).body.details;
    assert.deepEqual(first.find((r) => r.status === 409).body.details, current);
    const edits = await Promise.all(["Broker One", "Broker Two"].map((brokerName) => patch({
      plotId: "24", expectedRevision: 1, changes: { brokerName },
    })));
    assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
    assert.equal(db.prepare("SELECT revision FROM plot_admin_details").get().revision, 2);
    assert.equal(edits.find((r) => r.status === 409).body.details.revision, 2);
  } finally { db.close(); }
});

test("API rejects foreign tenants, inactive plots, malformed input and unauthorized roles", async () => {
  const { db, patch } = fixture();
  try {
    for (const plotId of ["99", "25", "missing"])
      assert.equal((await patch({ plotId, expectedRevision: 0, changes: { ownerName: "X" } })).status, 404);
    assert.equal((await patch("{invalid")).status, 400);
    assert.equal((await patch("x".repeat(8193))).status, 413);
    assert.equal((await patch({ plotId: "24", expectedRevision: 0, projectId: "tenant-b", changes: { ownerName: "X" } })).status, 400);
    assert.equal((await patch({ plotId: "24", expectedRevision: 0, changes: { status: "sold" } })).status, 400);
    assert.equal((await patch({ plotId: "24", expectedRevision: 0, changes: { bookingAmount: 5 } })).status, 400);
    assert.equal(db.prepare("SELECT count(*) n FROM plot_admin_details").get().n, 0);
  } finally { db.close(); }
  for (const [options, status] of [[{ session: null }, 401], [{ session: { role: "super_admin" } }, 403], [{ originAllowed: false }, 403]]) {
    const f = fixture(options);
    try { assert.equal((await f.patch({ plotId: "24", expectedRevision: 0, changes: { ownerName: "X" } })).status, status); }
    finally { f.db.close(); }
  }
});

test("same-value save does not create rows or advance revisions, and stale no-op still conflicts", async () => {
  const { db, patch } = fixture();
  try {
    const empty = await patch({ plotId: "24", expectedRevision: 0, changes: { bookingAmount: "" } });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.details.revision, 0);
    await patch({ plotId: "24", expectedRevision: 0, changes: { bookingAmount: "0" } });
    const same = await patch({ plotId: "24", expectedRevision: 1, changes: { bookingAmount: "0.00" } });
    assert.equal(same.body.details.revision, 1);
    const stale = await patch({ plotId: "24", expectedRevision: 0, changes: { bookingAmount: "0" } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.details.bookingAmountPaise, 0);
  } finally { db.close(); }
});

test("verified business save returns canonical success even when the separate audit write fails", async () => {
  const { db, patch } = fixture({ auditFails: true });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const saved = await patch({ plotId: "24", expectedRevision: 0,
      changes: { ownerName: "Private Owner", bookingAmount: "50000.29", brokerName: "Private Broker" } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ok, true);
    assert.equal(saved.body.details.ownerName, "Private Owner");
    assert.equal(saved.body.details.bookingAmountPaise, 5_000_029);
    assert.equal(saved.body.details.brokerName, "Private Broker");
    assert.equal(saved.body.details.revision, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM plot_admin_details").get().n, 1);
    assert.equal(db.prepare("SELECT revision FROM plot_admin_details").get().revision, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /saved but audit write failed/);
    assert.doesNotMatch(JSON.stringify(errors), /Private Owner|Private Broker|5000029/);
    const staleRetry = await patch({ plotId: "24", expectedRevision: 0,
      changes: { ownerName: "Private Owner" } });
    assert.equal(staleRetry.status, 409);
    assert.equal(staleRetry.body.details.revision, 1);
    // A same-value retry cannot duplicate or advance the already verified save.
    const retried = await patch({ plotId: "24", expectedRevision: 1,
      changes: { ownerName: "Private Owner", bookingAmount: "50000.29", brokerName: "Private Broker" } });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.details.revision, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM plot_admin_details").get().n, 1);
  } finally {
    console.error = originalError;
    db.close();
  }
});

test("a failed business write still returns 500 without saving or auditing a record", async () => {
  const { db, audits, patch } = fixture({ businessWriteFails: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await patch({ plotId: "24", expectedRevision: 0, changes: { ownerName: "Private Owner" } });
    assert.equal(result.status, 500);
    assert.equal(result.body.ok, undefined);
    assert.equal(db.prepare("SELECT count(*) n FROM plot_admin_details").get().n, 0);
    assert.equal(audits.length, 0);
  } finally {
    console.error = originalError;
    db.close();
  }
});
