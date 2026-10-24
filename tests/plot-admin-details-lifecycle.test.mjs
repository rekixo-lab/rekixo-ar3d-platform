import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [snapshot, mapper, publish, migration] = await Promise.all([
  read("../app/public-publish-snapshot.ts"),
  read("../app/api/super-mapper/route.ts"),
  read("../app/api/admin/publish/route.ts"),
  read("../drizzle/0036_rekixo_plot_admin_details.sql"),
]);
const compiled = ts.transpileModule(snapshot, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const runtime = {};
const env = { DB: { prepare(query) { return { bind(...values) { return { query, values }; } }; } } };
new Function("require", "exports", compiled)((name) => {
  assert.equal(name, "cloudflare:workers");
  return { env };
}, runtime);
const statements = runtime.finalizeInactivePlotInventoryStatements("a");
const diffQuery = mapper.match(/`SELECT\s+p\.id,[\s\S]*?ORDER BY p\.id`/)?.[0].slice(1, -1);
const protectedQuery = publish.match(/`SELECT p\.id FROM plots p[\s\S]*?ORDER BY p\.id`/)?.[0].slice(1, -1);

test("private details survive failed inventory finalization, including explicit zero amounts", () => {
  assert.ok(diffQuery, "actual inventory reconciliation query available");
  assert.ok(protectedQuery, "actual publish protection query available");
  const script = `
import json, sqlite3, sys
data=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.row_factory=sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
db.executescript('''
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE plots(project_id TEXT NOT NULL,id TEXT NOT NULL,sqft REAL,polygon TEXT,status TEXT,inventory_active INTEGER,PRIMARY KEY(project_id,id));
CREATE TABLE geo_features(project_id TEXT,linked_plot_id TEXT);
CREATE TABLE plot_edge_measurements(project_id TEXT,plot_id TEXT);
CREATE TABLE plot_pricing(project_id TEXT,plot_id TEXT);
CREATE TABLE property_sales(project_id TEXT,plot_id TEXT);
INSERT INTO projects VALUES('a'),('b');
INSERT INTO plots VALUES('a','24',1250,'[[0,0],[1,0],[1,1]]','booked',0),('b','24',900,'[[0,0],[0.5,0],[0.5,1]]','sold',1);
INSERT INTO geo_features VALUES('a','24'),('b','24');
INSERT INTO plot_edge_measurements VALUES('a','24'),('b','24');
INSERT INTO plot_pricing VALUES('a','24'),('b','24');
''')
before=[dict(row) for row in db.execute('SELECT * FROM plots ORDER BY project_id,id')]
db.executescript(data['migration'])
assert [dict(row) for row in db.execute('SELECT * FROM plots ORDER BY project_id,id')]==before
db.execute('INSERT INTO plot_admin_details(project_id,plot_id,owner_name,booking_amount_paise,broker_name,revision,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)',('a','24',None,0,None,1,'2026-10-19','admin-a'))
db.execute('INSERT INTO plot_admin_details(project_id,plot_id,owner_name,booking_amount_paise,broker_name,revision,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)',('b','24','Other owner',50000,'Other broker',1,'2026-10-19','admin-b'))
db.commit()
assert [dict(row) for row in db.execute(data['protectedQuery'],('a',))]==[{'id':'24'}]
assert dict(db.execute(data['diffQuery'],('a',)).fetchone())['hasAdminDetails']==1
try:
    db.execute('BEGIN')
    for statement in data['statements']:
        db.execute(statement['query'],statement['values'])
    db.commit()
    raise AssertionError('Populated booking record must block deletion')
except sqlite3.IntegrityError:
    db.rollback()
assert [dict(row) for row in db.execute('SELECT * FROM plots ORDER BY project_id,id')]==before
assert db.execute('SELECT booking_amount_paise FROM plot_admin_details WHERE project_id=?',('a',)).fetchone()[0]==0
assert db.execute('SELECT COUNT(*) FROM geo_features WHERE project_id=?',('a',)).fetchone()[0]==1
assert db.execute('SELECT COUNT(*) FROM plot_pricing WHERE project_id=?',('a',)).fetchone()[0]==1
assert db.execute('SELECT COUNT(*) FROM plot_edge_measurements WHERE project_id=?',('a',)).fetchone()[0]==1
# Only explicit clearing permits subsequent inventory removal; other projects
# with the same plot number remain unchanged and cannot inherit old details.
db.execute('UPDATE plot_admin_details SET booking_amount_paise=NULL,revision=2 WHERE project_id=?',('a',))
db.commit()
assert list(db.execute(data['protectedQuery'],('a',)))==[]
db.execute('BEGIN')
for statement in data['statements']:
    db.execute(statement['query'],statement['values'])
db.commit()
assert db.execute('SELECT COUNT(*) FROM plots WHERE project_id=?',('a',)).fetchone()[0]==0
assert db.execute('SELECT COUNT(*) FROM plot_admin_details WHERE project_id=?',('a',)).fetchone()[0]==0
assert db.execute('SELECT owner_name FROM plot_admin_details WHERE project_id=?',('b',)).fetchone()[0]=='Other owner'
assert db.execute('SELECT status FROM plots WHERE project_id=?',('b',)).fetchone()[0]=='sold'
db.execute('INSERT INTO plots VALUES(?,?,?,?,?,?)',('a','24',700,'','available',1))
assert db.execute('SELECT COUNT(*) FROM plot_admin_details WHERE project_id=?',('a',)).fetchone()[0]==0
print('migration preserves old rows; zero protected; finalization rolls back; explicit clear; tenant isolation; no reused-ID inheritance')
`;
  const result = spawnSync("python3", ["-c", script], {
    input: JSON.stringify({ migration, statements, diffQuery, protectedQuery }), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("inventory import blocks protected removals before replacing source assets", () => {
  const start = mapper.indexOf('if (kind === "plotSheet")');
  const write = mapper.indexOf("await env.BUCKET.put(objectKey", start);
  const block = mapper.slice(start, write);
  assert.match(block, /inventory\.missingAdminDetailsIds\.length/);
  assert.match(block, /PLOT_ADMIN_DETAILS_REMOVAL_BLOCKED/);
  assert.match(block, /status: 409/);
});
