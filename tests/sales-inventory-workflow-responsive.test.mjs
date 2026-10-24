import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=(p)=>readFileSync(new URL(p,import.meta.url),"utf8");
const status=read("../app/api/data/route.ts");
const summary=read("../app/api/client/sales/summary/route.ts");
const sales=read("../app/api/client/sales/route.ts");
const smart=read("../app/sales-smart-entry.tsx");
const admin=read("../app/admin-dashboard.tsx");
const ui=read("../app/client-sales-accounts.tsx");
const css=read("../app/globals.css");

test("Plot area data is scoped and excludes inactive plots; finance stays separate",()=>{
 assert.match(summary,/clientSalesAccess\(\)/);
 assert.match(summary,/WHERE project_id=\? AND inventory_active=1/);
 assert.match(summary,/SUM\(CASE WHEN sqft IS NOT NULL AND sqft>=0 THEN sqft ELSE 0 END\)/);
 assert.match(summary,/missingAreaCount/);
 assert.match(summary,/netSalesPaise:total,receivedPaise:received,outstandingPaise:total-received/);
 assert.match(ui,/प्लॉट Area देखें/);
 assert.match(ui,/inventory\.available\.areaSqft/);
 assert.match(ui,/inventory\.booked\.areaSqft/);
 assert.match(ui,/inventory\.sold\.areaSqft/);
 assert.match(ui,/inventory\.missingAreaCount/);
 assert.doesNotMatch(read("../app/api/public-data/route.ts"),/sales_customers|sales_payments/);
});

test("Require buyer contact, keep prior buyer data, and synchronize Sale to Sold",()=>{
 assert.match(sales,/mobile\.replace\(\/\\D\/g,""\)\.length<10/);
 assert.match(sales,/address\.length<8/);
 assert.match(sales,/if\(expectedStatus!=="sold"&&!markSold\)/);
 assert.match(sales,/UPDATE sales_customers/);
 assert.match(sales,/mobile=CASE WHEN mobile IS NULL OR TRIM\(mobile\)=''/);
 assert.match(sales,/address=CASE WHEN address IS NULL OR TRIM\(address\)=''/);
 assert.match(smart,/missingMobile/);
 assert.match(smart,/missingAddress/);
 assert.match(smart,/initialPlotId/);
 assert.match(smart,/Confirm & Save Sale/);
 assert.match(smart,/will also mark this plot/);
 assert.match(admin,/setGuidedPlotId\(plot.id\)/);
 assert.match(admin,/salesRole==="viewer"/);
});

test("SQL guards existing sales against invalid status changes",()=>{
 assert.match(status,/SALE_DETAILS_REQUIRED/);
 assert.match(status,/ACTIVE_SALE_STATUS_PROTECTED/);
 assert.match(status,/AND \(\?='sold' OR NOT EXISTS/);
 assert.match(status,/flag\.key='salesAccountsEnabled' AND flag\.value='1'/);
 assert.match(status,/AND id=\? AND status=\? AND inventory_active=1/);
 assert.match(sales,/env\.DB\.batch\(mutations\)/);
 assert.match(sales,/CASE WHEN EXISTS\(/);
});

test("Compact mobile/tablet layout applies to finance cards and ledger",()=>{
 assert.match(css,/REKIXO_SALES_STOCK_RESPONSIVE_V3/);
 assert.match(css,/@container \(max-width:860px\)/);
 assert.match(css,/@container \(max-width:540px\)/);
 assert.match(css,/@container \(max-width:350px\)/);
 assert.match(css,/sales-register-scroll/);
 assert.match(css,/overscroll-behavior-inline:contain/);
 assert.match(ui,/sales-finance-grid/);
 assert.match(ui,/sales-inventory-grid/);
});

test("SQLite validates per-project area sums and atomic guarded plot changes",()=>{
 const first=summary.split("const inventoryRows=await env.DB.prepare(")[1];
 const second=status.split("const update=await env.DB.prepare(")[1];
 assert.ok(first&&second,"SQL declarations must exist");
 const query=first.split("\n    .bind(projectId)")[0].trim().replace(/^\(/,"").replace(/\)$/,"").slice(1,-1);
 const guarded=second.split("\n        .bind(status,now")[0].trim().replace(/^\(/,"").replace(/\)$/,"").slice(1,-1);
 const python=[
 "import json,sys,sqlite3",
 "d=json.load(sys.stdin);db=sqlite3.connect(':memory:')",
 "db.executescript(\"CREATE TABLE plots(project_id TEXT,id TEXT,status TEXT,sqft REAL,inventory_active INTEGER,updated_at TEXT,PRIMARY KEY(project_id,id)); CREATE TABLE settings(project_id TEXT,key TEXT,value TEXT,PRIMARY KEY(project_id,key)); CREATE TABLE property_sales(project_id TEXT,plot_id TEXT,state TEXT,id TEXT); INSERT INTO plots VALUES('a','1','available',100,1,'now'),('a','2','booked',150,1,'now'),('a','3','sold',200,1,'now'),('a','4','sold',NULL,1,'now'),('a','5','available',900,0,'now'),('b','1','sold',5000,1,'now'); INSERT INTO settings VALUES('a','salesAccountsEnabled','1');\")",
 "rows=db.execute(d['q'],('a',)).fetchall();m={s:(n,area,missing) for s,n,area,missing in rows}",
 "assert m=={'available':(1,100,0),'booked':(1,150,0),'sold':(2,200,1)},m",
 "def change(plot,target,previous): return db.execute(d['u'],(target,'later','a',plot,previous,target,target)).rowcount",
 "assert change('1','sold','available')==0",
 "db.execute(\"INSERT INTO property_sales VALUES('a','1','active','sale1')\")",
 "assert change('1','sold','available')==1",
 "assert change('1','available','sold')==0",
 "assert change('1','booked','sold')==0",
 "db.execute(\"UPDATE settings SET value='0' WHERE project_id='a' AND key='salesAccountsEnabled'\")",
 "assert change('2','sold','booked')==1",
 "assert db.execute(\"SELECT status FROM plots WHERE id='1' AND project_id='b'\").fetchone()[0]=='sold'"
 ].join("\n");
 const result=spawnSync("python3",["-c",python],{input:JSON.stringify({q:query,u:guarded}),encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
