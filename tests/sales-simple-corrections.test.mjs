import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const saleApi=read("../app/api/client/sales/route.ts");
const corrections=read("../app/api/client/sales/corrections/route.ts");
const docs=read("../app/api/client/sales/documents/route.ts");
const adjustments=read("../app/api/client/sales/adjustments/route.ts");
const simple=read("../app/client-sales-accounts.tsx");
const quick=read("../app/sales-smart-entry.tsx");
const policy=read("../app/sales-accounts-server.ts");
const css=read("../app/globals.css");
const migration=read("../drizzle/0040_sales_safe_corrections.sql");
test("Quick Sale can record optional first receipt in a single guarded D1 batch",()=>{
 assert.match(quick,/Quick Sale/);
 assert.match(quick,/firstPaymentAmount/);
 assert.match(quick,/firstPaymentMethod/);
 assert.match(quick,/बाकी रकम/);
 assert.match(quick,/एक बार जाँच लें/);
 assert.match(saleApi,/firstPayment>Number\(amount\|\|0\)/);
 assert.match(saleApi,/if\(firstPayment>0\)/);
 assert.match(saleApi,/mutations\.push\(env\.DB\.prepare\(\`INSERT INTO sales_payments/);
 assert.match(saleApi,/await env\.DB\.batch\(mutations\)/);
});
test("Safe cancellation is approver only, guarded against uncorrected receipts",()=>{
 assert.match(corrections,/if\(!canApprove\(role\)\)/);
 assert.match(corrections,/body\?\.confirmation!==sale\.plotId/);
 assert.match(corrections,/UPDATE property_sales/);
 assert.match(corrections,/state='void'/);
 assert.match(corrections,/p\.kind='receipt' AND NOT EXISTS/);
 assert.match(corrections,/r\.kind='reversal' AND r\.reversed_payment_id=p\.id/);
 assert.match(corrections,/plotStatusUnchanged:true/);
 assert.match(corrections,/sales\.sale_voided/);
 assert.match(policy,/sales_permissions/);
});
test("Buyer correction protected by scope/revision; adjustment undo compensates",()=>{
 assert.match(corrections,/WHERE project_id=\? AND id=\? AND revision=\? AND state='active'/);
 assert.match(corrections,/shared\?\.count\|\|0/);
 assert.match(corrections,/env\.DB\.batch\(\[/);
 assert.match(adjustments,/if\(b\?\.action==="undoAdjustment"\)/);
 assert.match(adjustments,/a\.reverses_adjustment_id IS NULL/);
 assert.match(adjustments,/u\.reverses_adjustment_id=a\.id/);
 assert.match(adjustments,/a\.kind='discount' OR/);
 assert.match(migration,/reverses_adjustment_id/);
});
test("Installments and private R2 files are non-destructively correctable",()=>{
 assert.match(migration,/ALTER TABLE sales_installments ADD COLUMN cancelled_at/);
 assert.match(migration,/ALTER TABLE sale_documents ADD COLUMN archived_at/);
 assert.match(adjustments,/if\(b\?\.action==="cancelInstallment"\)/);
 assert.match(adjustments,/cancelled_at IS NULL/);
 assert.match(docs,/archived_at IS NULL LIMIT 1/);
 assert.match(docs,/export async function PATCH/);
 assert.match(docs,/document_restored/);
 assert.doesNotMatch(docs,/await env\.BUCKET\.delete\(row\.objectKey\)/);
});
test("Simple mode keeps advanced features behind disclosure on mobile/tablet",()=>{
 assert.match(simple,/sales-finance-grid/);
 assert.match(simple,/More Options/);
 assert.match(simple,/गलती सुधारें/);
 assert.match(simple,/Cancel installment/);
 assert.match(simple,/Undo Payment/);
 assert.match(simple,/Restore/);
 assert.match(css,/AR3D_SIMPLE_ACCOUNTS_V4/);
 assert.match(css,/@container \(max-width:500px\)/);
});
test("SQLite void SQL only works after payment reversals and preserves original",()=>{
 const match=corrections.match(/UPDATE property_sales\s+SET state='void',revision=revision\+1[\s\S]*?RETURNING id/);
 assert.ok(match,"guarded sale void SQL missing");
 const py=[
 "import sqlite3,json,sys",
 "sql=json.load(sys.stdin)['sql'];db=sqlite3.connect(':memory:')",
 "db.executescript(\"CREATE TABLE property_sales(project_id TEXT,id TEXT,state TEXT,revision INT); CREATE TABLE sales_payments(project_id TEXT,id TEXT,sale_id TEXT,kind TEXT,reversed_payment_id TEXT); INSERT INTO property_sales VALUES('a','s','active',1); INSERT INTO sales_payments VALUES('a','p','s','receipt',NULL);\")",
 "assert db.execute(sql,('a','s',1)).fetchone() is None",
 "assert db.execute(\"SELECT state FROM property_sales WHERE id='s'\").fetchone()[0]=='active'",
 "db.execute(\"INSERT INTO sales_payments VALUES('a','r','s','reversal','p')\")",
 "assert db.execute(sql,('a','s',1)).fetchone()==('s',)",
 "assert db.execute(\"SELECT COUNT(*) FROM sales_payments\").fetchone()[0]==2",
 "assert db.execute(sql,('a','s',1)).fetchone() is None",
 ].join("\n");
 const res=spawnSync("python3",["-c",py],{encoding:"utf8",input:JSON.stringify({sql:match[0]})});
 assert.equal(res.status,0,res.stderr||res.stdout);
});
