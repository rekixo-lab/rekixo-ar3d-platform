import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const p=read("../app/api/client/sales/payments/route.ts");
const a=read("../app/api/client/sales/adjustments/route.ts");
const s=read("../app/api/client/sales/summary/route.ts");
const ui=read("../app/client-sales-accounts.tsx");
test("Phase 3 payment insert is balance guarded and idempotent",()=>{
 assert.match(p,/WHERE s.project_id=\? AND s.id=\? AND s.state='active'/);
 assert.match(p,/balanceSql}>=\?/);
 assert.match(p,/idempotency_key=\?/);
 assert.match(p,/result\.meta\.changes/);
 assert.match(p,/NOT EXISTS\(SELECT 1 FROM sales_payments r/);
 assert.match(p,/canApprove\(role\)/);
 assert.match(p,/reversed_payment_id/);
 assert.match(p,/salesAudit/);
 assert.match(read("../drizzle/0039_project_sales_accounts.sql"),/UNIQUE\(project_id,idempotency_key\)/);
 assert.match(read("../drizzle/0039_project_sales_accounts.sql"),/UNIQUE INDEX.*idx_sales_one_reversal_per_receipt/);
});
test("Phase 3 adjustments and reports do not infer deposits from booking amounts",()=>{
 assert.match(a,/canApprove\(access\.context\.role\)/);
 assert.match(a,/s.state='active'/);
 assert.match(a,/sales_adjustments/);
 assert.match(a,/sales_installments/);
 assert.match(s,/JOIN property_sales s ON s.project_id=p.project_id/);
 assert.match(s,/netSalesPaise:total,receivedPaise:received,outstandingPaise:total-received/);
 assert.doesNotMatch(p+a+s,/booking_amount_paise/);
});
test("Phase 3 mobile UI has totals, stable retry key, due list and controlled reversals",()=>{
 assert.match(ui,/api\\/client\\/sales\\/summary/);
 assert.match(ui,/retryKey\.current\|\|/);
 assert.match(ui,/retryKey\.current=null/);
 assert.match(ui,/ScheduleForm/);
 assert.match(ui,/ApprovalActions/);
 assert.match(ui,/role==="approver"/);
});
