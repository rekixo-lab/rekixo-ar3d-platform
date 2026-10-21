import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const sql = fs.readFileSync("drizzle/0037_talib_plot32_side_measurement_text.sql", "utf8");
const revisionSql = fs.readFileSync("drizzle/0038_talib_plot32_customer_data_revision.sql", "utf8");
const projectId = "e94cec2c-e3f7-4a13-aa75-5ec4167baaf2";
const original = `User-confirmed Front 176'-9"; rear outer boundary 198'-6"; right boundary 63'-9"; sloping outer left boundary 91'-4"; upper boundary shared with plot31 88'-3"; road-junction step 16'-0".`;
const corrected = `Front 176'-9" · Back 198'-6" · Right 63'-9" · Sloping left 91'-4" · Upper 88'-3" · Road step 16'-0"`;

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT, slug TEXT, status TEXT);
    CREATE TABLE plots(project_id TEXT, id TEXT, side_dimensions TEXT, polygon TEXT, sqft REAL, status TEXT, updated_at TEXT, PRIMARY KEY(project_id,id));
    CREATE TABLE published_plots AS SELECT * FROM plots;
    CREATE TABLE published_settings(project_id TEXT, key TEXT, value TEXT, PRIMARY KEY(project_id,key));
  `);
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(projectId, "TALIB NAZAMI ALAM  PLOTING", "talib-nazami-alam-ploting-e94cec", "active");
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run("other", "Other", "other", "active");
  for (const table of ["plots", "published_plots"]) {
    const insert = db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?)`);
    for (const [tenant, id] of [[projectId, "32"], [projectId, "31"], ["other", "32"]]) {
      insert.run(tenant, id, original, "[[0,0],[1,0],[0,1]]", 1000, "available", "unchanged");
    }
  }
  return db;
}

function rows(db, table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY project_id,id`).all().map(row => ({ ...row }));
}

test("correct only the intended draft and published text, retaining all six dimensions and every other field", () => {
  const db = fixture();
  const before = new Map(["plots", "published_plots"].map(table => [table, rows(db, table)]));
  db.exec(sql);
  for (const [table, snapshot] of before) {
    const expected = snapshot.map(row => row.project_id === projectId && row.id === "32"
      ? { ...row, side_dimensions: corrected } : row);
    assert.deepEqual(rows(db, table), expected);
    db.exec(sql);
    assert.deepEqual(rows(db, table), expected, "replay must be idempotent");
  }
  assert.deepEqual(corrected.match(/\d+'-\d+"/g), original.match(/\d+'-\d+"/g));
  db.close();
});

test("refresh only corrected customer data and preserve later cache revisions", () => {
  const db = fixture();
  db.exec(revisionSql);
  assert.equal(db.prepare("SELECT count(*) AS n FROM published_settings").get().n, 0);
  db.exec(sql);
  const before = [rows(db, "plots"), rows(db, "published_plots")];
  db.exec(revisionSql);
  assert.deepEqual(db.prepare("SELECT * FROM published_settings").all().map(row => ({ ...row })), [
    { project_id: projectId, key: "publicDataRevision", value: "plot32-text-v1" },
  ]);
  assert.deepEqual([rows(db, "plots"), rows(db, "published_plots")], before);
  db.prepare("UPDATE published_settings SET value=?").run("later-user-revision");
  db.exec(revisionSql);
  assert.equal(db.prepare("SELECT value FROM published_settings").get().value, "later-user-revision");
  db.close();
});

test("leave later user edits and mismatched project identities untouched", () => {
  for (const change of [
    `UPDATE projects SET slug='different' WHERE id='${projectId}'`,
    `UPDATE projects SET name='different' WHERE id='${projectId}'`,
    `UPDATE projects SET status='archived' WHERE id='${projectId}'`,
    `UPDATE plots SET side_dimensions='Later user edit'; UPDATE published_plots SET side_dimensions='Later user edit'`,
    "DELETE FROM projects",
  ]) {
    const db = fixture();
    db.exec(change);
    const before = [rows(db, "plots"), rows(db, "published_plots")];
    db.exec(sql);
    assert.deepEqual([rows(db, "plots"), rows(db, "published_plots")], before);
    db.close();
  }
});
