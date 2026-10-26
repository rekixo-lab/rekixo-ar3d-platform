import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const read=path=>readFileSync(path,"utf8");
test("additive migration preserves original plots/sales and seeds only verified Metro City",()=>{
  const output=execFileSync("python3",["scripts/verify-project-admin-studio-migration.py"],{encoding:"utf8"});
  assert.match(output,/PASS Admin Studio migration/);
});
test("status remains canonical and Deal Progress remains private tenant-scoped",()=>{
  const api=read("app/api/client/deal-progress/route.ts");
  assert.match(api,/session\.projectId/);
  assert.match(api,/session\.role!=="client_admin"/);
  assert.match(api,/WHERE project_id=\? AND id=\? AND inventory_active=1/);
  assert.match(api,/plot\.status!=="sold"\|\|!sale/);
  assert.match(api,/revision=revision\+1/);
  assert.match(api,/plot_deal_events/);
  assert.doesNotMatch(api,/UPDATE plots SET status|UPDATE property_sales|INSERT INTO sales_payments/);
  assert.match(read("app/api/admin/project-admin-studio/route.ts"),/requireSuperAdmin\(\)/);
  assert.match(read("app/api/admin/project-admin-studio/route.ts"),/sameOrigin\(request\)/);
});
test("project-specific feature gate hides new navigation in all other clients",()=>{
  const dashboard=read("app/admin-dashboard.tsx");
  assert.match(dashboard,/setStudioEnabled\(Boolean\(data\?\.features\?\.dealProgress\|\|data\?\.features\?\.customFields\)\)/);
  assert.match(dashboard,/tab==="deals"&&studioEnabled&&user\.role==="client_admin"/);
  assert.match(read("app/super-admin-dashboard.tsx"),/ProjectAdminStudioManager/);
  const client=read("app/api/client/deal-progress/route.ts");
  assert.match(client,/if\(!features\.dealProgress&&!features\.customFields\)/);
});
test("custom values use allowlisted types and revision-gated updates",()=>{
  const p=read("app/project-admin-studio-policy.ts");
  assert.match(p,/text"\|"number"\|"date"\|"select"\|"checkbox/);
  assert.match(p,/validateCustomValue/);
  assert.match(read("app/api/client/deal-progress/route.ts"),/field_value=\?,revision=revision\+1/);
  assert.match(read("app/api/admin/project-admin-studio/route.ts"),/Cannot change field type\/options after values exist/);
});
test("existing public and financial data paths are untouched by new changes",()=>{
  const source=read("app/api/public-live/route.ts");
  assert.doesNotMatch(source,/plot_deal_states|project_deal_stages|plot_custom_values/);
  const publicHtml=read("public/project/index.html");
  assert.doesNotMatch(publicHtml,/project_admin_features|project_custom_fields/);
  const exportEndpoint=read("app/api/admin/project-admin-studio/export/route.ts");
  assert.match(exportEndpoint,/requireSuperAdmin\(\)/);
  assert.match(exportEndpoint,/WHERE project_id=\?/);
});
