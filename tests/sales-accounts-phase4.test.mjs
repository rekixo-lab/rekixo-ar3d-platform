import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const route=read("../app/api/admin/sales-controls/route.ts");
const superUi=read("../app/super-admin-dashboard.tsx");
const controls=read("../app/sales-controls.tsx");
const gate=read("../app/sales-accounts-server.ts");
test("Phase 4 Super Admin alone controls activation and per-user roles",()=>{
 assert.match(route,/requireSuperAdmin\(\)/);
 assert.match(route,/sameOrigin\(request\)/);
 assert.match(route,/admin_users WHERE id=\? AND project_id=\? AND role='client_admin' AND status='active'/);
 assert.match(route,/settings\(project_id,key,value,updated_at\)/);
 assert.match(route,/salesAccountsEnabled/);
 assert.match(route,/sales_permissions/);
 assert.match(route,/writeAudit\(actor,/);
});
test("Phase 4 Client Admin has no implicit permission and cannot switch projects",()=>{
 assert.match(gate,/session\.role!=="client_admin"/);
 assert.match(gate,/const projectId=session\.projectId/);
 assert.match(gate,/salesAccountsEnabled/);
 assert.match(gate,/permission\|\|!/);
 assert.match(gate,/permission\.level/);
 assert.match(gate,/return \{ok:false,response:salesResponse\(\{error:"Sales access not granted"\},403\)\}/);
 assert.doesNotMatch(gate,/projectId=request/);
});
test("Phase 4 permission workspace only modifies current selected project",()=>{
 assert.match(superUi,/tab === "accounts"/);
 assert.match(superUi,/<SalesControls key=\{projectId\} projectId=\{projectId\}/);
 assert.match(controls,/No access/);
 assert.match(controls,/viewer/);
 assert.match(controls,/editor/);
 assert.match(controls,/approver/);
});
