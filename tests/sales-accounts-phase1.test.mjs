import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import ts from "typescript";
const sql=readFileSync(new URL("../drizzle/0039_project_sales_accounts.sql",import.meta.url),"utf8");
const core=readFileSync(new URL("../app/sales-accounts-core.ts",import.meta.url),"utf8");
const module={exports:{}};
new Function("exports","module",ts.transpileModule(core,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module.exports,module);
const {parseMoneyPaise,salesBalance,validSaleDate}=module.exports;
test("exact payment units and valid dates",()=>{
  assert.equal(parseMoneyPaise("10.05"),1005);
  assert.equal(parseMoneyPaise("0.01"),1);
  assert.equal(parseMoneyPaise("0"),null);
  assert.equal(parseMoneyPaise("0",true),0);
  assert.equal(parseMoneyPaise("1.234"),null);
  assert.equal(parseMoneyPaise("-10"),null);
  assert.equal(parseMoneyPaise("1e5"),null);
  assert.equal(validSaleDate("2026-02-29"),false);
  assert.equal(validSaleDate("2028-02-29"),true);
  assert.deepEqual(salesBalance({agreementPaise:10000,chargesPaise:500,discountsPaise:1000,receiptsPaise:3000,reversalsPaise:500}),{netSale:9500,received:2500,balance:7000});
});
test("D1 migration applies additively, enforces project scopes, FK & idempotency",()=>{
 const script=`import json,sqlite3,sys
s=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript("CREATE TABLE projects(id TEXT PRIMARY KEY);CREATE TABLE admin_users(id TEXT PRIMARY KEY);CREATE TABLE plots(project_id TEXT,id TEXT,PRIMARY KEY(project_id,id));INSERT INTO projects VALUES('a'),('b');INSERT INTO admin_users VALUES('u');INSERT INTO plots VALUES('a','1'),('b','1');")
db.executescript(s['sql'])
db.executescript(s['sql'])
db.execute("INSERT INTO sales_customers VALUES('a','c','Buyer',NULL,NULL,'u','t','t')")
try:
 db.execute("INSERT INTO property_sales VALUES('b','s','1','c',10000,'2026-10-24','active','u','t',1)")
 raise AssertionError('Cross-project buyer must not join sale')
except sqlite3.IntegrityError: pass
db.execute("INSERT INTO property_sales VALUES('a','s','1','c',10000,'2026-10-24','active','u','t',1)")
db.execute("INSERT INTO sales_payments VALUES('a','p','s','receipt',1000,'2026-10-24','upi',NULL,NULL,NULL,'key','u','t')")
try:
 db.execute("INSERT INTO sales_payments VALUES('a','q','s','receipt',1000,'2026-10-24','upi',NULL,NULL,NULL,'key','u','t')")
 raise AssertionError('Idempotency failed')
except sqlite3.IntegrityError: pass
try:
 db.execute("DELETE FROM plots WHERE project_id='a' AND id='1'")
 raise AssertionError('Financial plot deletion was permitted')
except sqlite3.IntegrityError: pass
assert db.execute("SELECT COUNT(*) FROM property_sales").fetchone()[0]==1
print('D1 additive schema, scoped FK, protected plot, idempotency OK')
`;
 const r=spawnSync("python3",["-c",script],{encoding:"utf8",input:JSON.stringify({sql})});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
