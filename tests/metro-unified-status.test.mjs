import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=p=>readFileSync(p,"utf8");
const api=read("app/api/client/metro-status/route.ts");
const policy=read("app/metro-status.ts");
const admin=read("app/admin-dashboard.tsx");
const client=read("app/client-plot-management.tsx");
const data=read("app/api/data/route.ts");
const deals=read("app/api/client/deal-progress/route.ts");

test("Metro-only four choices map to three canonical inventories plus the agreement flag",()=>{
 assert.match(policy,/status==="registered"\|\|status==="agreement"\?"sold":status/);
 assert.match(policy,/agreementDone:status==="agreement"/);
 assert.match(policy,/if\(agreementDone\)return "agreement"/);
 assert.match(client,/<option value="registered">Registered<\/option>/);
 assert.match(client,/<option value="agreement">Agreement Done<\/option>/);
 assert.match(client,/plot\.agreementDone\?"agreement":plot\.status==="sold"\?"registered"/);
 assert.doesNotMatch(client,/type="checkbox"|client-booking-agreement|onAgreementSaved/);
 assert.match(client,/client-metro-legacy-warning/);
 assert.match(admin,/\/api\/client\/metro-status/);
 assert.match(admin,/setPlotRefresh\(n=>n\+1\)/);
 assert.match(admin,/value=\{counts\.agreement\}/);
 assert.match(data,/if\(agreementByPlot\.get\(row\.id\)\?\.done\)\{counts\.agreement\+\+;continue\}/);
});

test("unified PATCH validates admin, project, revision, active Sale and read-back",()=>{
 assert.match(api,/sameOrigin\(request\)/);
 assert.match(api,/session\.role!=="client_admin"/);
 assert.match(api,/metroAgreementEnabled\(session\.projectId\)/);
 assert.match(api,/isMetroDisplayStatus\(target\)/);
 assert.match(api,/beforeRevision!==expectedRevision/);
 assert.match(api,/AGREEMENT_REQUIRES_SALE/);
 assert.match(api,/ACTIVE_SALE_STATUS_PROTECTED/);
 assert.match(api,/SALE_DETAILS_REQUIRED/);
 assert.match(api,/json\('metro-status-conflict'\)/);
 assert.match(api,/env\.DB\.batch\(statements\)/);
 assert.match(api,/saved\.status!==desired\.inventoryStatus/);
 assert.match(api,/writeAudit\(session/);
 assert.doesNotMatch(api,/UPDATE property_sales|DELETE FROM property_sales|INSERT INTO property_sales/);
 assert.match(data,/METRO_STATUS_UNIFIED_ROUTE_REQUIRED/);
 assert.match(deals,/fieldKey===METRO_AGREEMENT_FIELD/);
 assert.match(deals,/slug==="agreement_done"\|\|slug==="registered"/);
});

test("D1 guarded transaction SQL rejects stale values and unsafe transitions before writes",()=>{
 const guard=api.match(/const guard=env\.DB\.prepare\(\`([\s\S]*?)\`\)/)?.[1];
 assert.ok(guard,"Extract server's actual SQL guard");
 const py=String.raw`
import sqlite3,sys,json
s=json.load(sys.stdin)
con=sqlite3.connect(":memory:")
con.executescript("""
CREATE TABLE projects(id TEXT,slug TEXT,name TEXT,status TEXT);
CREATE TABLE plots(project_id TEXT,id TEXT,status TEXT,inventory_active INTEGER,updated_at TEXT);
CREATE TABLE project_custom_fields(project_id TEXT,field_key TEXT,field_type TEXT,enabled INTEGER);
CREATE TABLE plot_custom_values(project_id TEXT,plot_id TEXT,field_key TEXT,field_value TEXT,revision INTEGER,updated_at TEXT,updated_by TEXT);
CREATE TABLE property_sales(project_id TEXT,plot_id TEXT,state TEXT,id TEXT);
CREATE TABLE settings(project_id TEXT,key TEXT,value TEXT);
INSERT INTO projects VALUES('metro','metro-city-c024a5','Metro City','active');
INSERT INTO projects VALUES('other','sample','Other','active');
INSERT INTO project_custom_fields VALUES('metro','agreement_done','checkbox',1);
INSERT INTO plots VALUES('metro','3','booked',1,'today');
INSERT INTO plots VALUES('metro','4','sold',1,'today');
INSERT INTO plots VALUES('other','3','booked',1,'today');
INSERT INTO settings VALUES('metro','salesAccountsEnabled','1');
INSERT INTO plot_custom_values VALUES('metro','4','agreement_done','false',2,'today','admin');
INSERT INTO property_sales VALUES('metro','4','active','sale4');
""")
guard=s["sql"]
def check(plot,previous,rev,flag,target,category,project='metro'):
 try:
  return con.execute(guard,(project,plot,previous,rev,flag,target,category,category)).fetchone()[0]==1
 except sqlite3.DatabaseError:
  return False
assert check('4','sold',2,'false','sold','agreement')
assert not check('4','sold',1,'false','sold','agreement'),"stale agreement revision"
assert not check('4','booked',2,'false','sold','agreement'),"stale inventory"
assert not check('4','sold',2,'true','sold','agreement'),"stale checkbox"
assert not check('4','sold',2,'false','booked','booked'),"active sale blocks booked"
assert not check('3','booked',0,'false','sold','agreement'),"unconfirmed agreement"
assert not check('3','booked',0,'false','sold','registered'),"sales setting needs sale"
assert not check('3','booked',0,'false','booked','booked',project='other'),"tenant gate"
with con:
 assert check('4','sold',2,'false','sold','agreement')
 con.execute("UPDATE plot_custom_values SET field_value='true',revision=revision+1 WHERE project_id='metro' AND plot_id='4'")
assert not check('4','sold',2,'false','sold','agreement'),"repeated submission rejected"
assert check('4','sold',3,'true','sold','registered'),"agreement rollback is legal"
assert con.execute("SELECT status FROM plots WHERE project_id='other'").fetchone()[0]=='booked'
print("PASS: guarded Metro transition SQL, stale revisions, sales and tenant isolation")
`;
 const r=spawnSync("python3",["-c",py],{input:JSON.stringify({sql:guard}),encoding:"utf8"});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
