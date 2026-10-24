import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import ts from "typescript";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const entry=read("../app/sales-smart-entry.tsx");
const parent=read("../app/client-sales-accounts.tsx");
const admin=read("../app/admin-dashboard.tsx");
const assist=read("../app/api/client/sales/assist/route.ts");
const backend=read("../app/api/client/sales/route.ts");
const css=read("../app/globals.css");
const policy=read("../app/sales-smart-entry-policy.ts");
const module={exports:{}};
new Function("module","exports",ts.transpileModule(policy,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
const {localSaleDate,suggestedAgreement,hasSaleDraft}=module.exports;
test("Suggested price is optional, accurate and separate from booking",()=>{
 const plot={id:"B1",status:"booked",sqft:1000,sqm:92.903,sqyd:111.111,pricingType:"rate",unit:"sqft",rate:500,fixedPrice:null,currency:"INR",bookingAmountPaise:3000000};
 assert.equal(suggestedAgreement(plot),"500000.00");
 assert.equal(suggestedAgreement({...plot,unit:"sqyd",rate:1000}),"111111.00");
 assert.equal(suggestedAgreement({...plot,pricingType:"fixed",fixedPrice:1250000}),"1250000.00");
 assert.equal(suggestedAgreement({...plot,currency:"USD"}),null);
 assert.equal(localSaleDate(new Date("2026-10-23T20:00:00Z")),"2026-10-24");
 assert.equal(hasSaleDraft({plotId:"1",buyerName:"",buyerMobile:"",buyerAddress:"",agreementAmount:"",buyerId:""}),true);
});
test("Project-only searchable scroll list, natural IDs and duplicate-sold warning",()=>{
 assert.match(assist,/clientSalesAccess\(\)/);
 assert.match(assist,/const \{projectId\}=access.context/);
 assert.match(assist,/p\.project_id=\? AND p\.inventory_active=1/);
 assert.match(assist,/active\.state='active'/);
 assert.match(assist,/LIMIT 101/);
 assert.match(assist,/WHERE project_id=\?/);
 assert.match(entry,/role="listbox"/);
 assert.match(entry,/Search Plot 1, B1, C2/);
 assert.match(entry,/activeSaleId/);
 assert.match(css,/sales-picker-list\{max-height:260px;overflow:auto/);
});
test("Visible form borders, mobile fields, review, buyer reuse and draft safety",()=>{
 assert.match(css,/border:1px solid var\(--sales-border/);
 assert.match(css,/input\[type=date\]\{color-scheme:dark/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(parent,/sales-inline-form/);
 assert.match(entry,/buyerId:buyer\.id/);
 assert.match(entry,/Review before saving/);
 assert.match(entry,/window\.addEventListener\("beforeunload"/);
 assert.match(admin,/salesDraft\.current&&!window\.confirm/);
 assert.match(admin,/onSaleSaved=\{\(\)=>setPlotRefresh/);
});
test("Backend keeps sale status, buyer reuse and public privacy scoped",()=>{
 assert.match(backend,/body\.markSold===true/);
 assert.match(backend,/SELECT id FROM sales_customers WHERE project_id=\? AND id=\?/);
 assert.match(backend,/const results=await env\.DB\.batch\(mutations\)/);
 assert.match(backend,/CASE WHEN EXISTS\(/);
 assert.match(backend,/THEN \? ELSE 0 END/);
 assert.match(backend,/UPDATE plots SET status='sold'/);
 assert.doesNotMatch(read("../app/api/public-data/route.ts"),/sales_customers|sales_payments/);
});
test("SQLite guard rolls back stale buyer/sale transaction",()=>{
 const m=backend.match(/INSERT INTO property_sales[\s\S]*?RETURNING id/);
 assert.ok(m,"Missing transactional insert");
 const script=[
 'import sqlite3,json,sys',
 'v=json.load(sys.stdin);db=sqlite3.connect(":memory:");db.execute("PRAGMA foreign_keys=ON")',
 'db.executescript("CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE admin_users(id TEXT PRIMARY KEY); CREATE TABLE plots(project_id TEXT,id TEXT,status TEXT,inventory_active INT,updated_at TEXT,PRIMARY KEY(project_id,id));INSERT INTO projects VALUES(\\u0027a\\u0027);INSERT INTO admin_users VALUES(\\u0027u\\u0027);INSERT INTO plots VALUES(\\u0027a\\u0027,\\u0027B1\\u0027,\\u0027available\\u0027,1,\\u0027now\\u0027);")',
 'db.executescript(v["migration"])',
 'def buyer(k): db.execute("INSERT INTO sales_customers(project_id,id,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)",("a",k,"Buyer","u","now","now"))',
 'def sale(s,b,st): return db.execute(v["sql"],("a",s,"B1",b,"a","B1",st,50000000,"2026-10-24","u","now")).fetchone()',
 'try:',
 ' with db: buyer("b1");sale("s1","b1","sold")',
 ' raise AssertionError("Stale plot accepted")',
 'except sqlite3.IntegrityError: pass',
 'assert db.execute("SELECT COUNT(*) FROM sales_customers").fetchone()[0]==0',
 'with db: buyer("b2");assert sale("s2","b2","available")==("s2",)',
 'assert db.execute("SELECT COUNT(*) FROM property_sales").fetchone()[0]==1'
 ].join("\n");
 const r=spawnSync("python3",["-c",script],{encoding:"utf8",input:JSON.stringify({sql:m[0],migration:read("../drizzle/0039_project_sales_accounts.sql")})});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
