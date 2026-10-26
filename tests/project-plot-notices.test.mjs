import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const read=x=>readFileSync(x,"utf8");
test("notice migration is idempotent and never touches original project data",()=>{
 const result=execFileSync("python3",["scripts/verify-project-plot-notices.py"],{encoding:"utf8"});
 assert.match(result,/PASS: additive and idempotent migration/);
});
test("plot number sequence is numeric with prefixed IDs and pagination",()=>{
 const api=read("app/api/client/deal-progress/route.ts");
 assert.match(api,/CAST\(p\.id AS INTEGER\)/);
 assert.match(api,/CAST\(SUBSTR\(p\.id,3\) AS INTEGER\)/);
 assert.match(api,/CAST\(SUBSTR\(p\.id,2\) AS INTEGER\)/);
 assert.match(api,/LIMIT 50 OFFSET \?/);
 assert.doesNotMatch(api,/ORDER BY p\.id COLLATE NOCASE LIMIT 50 OFFSET \?/);
});
test("public notices are approved project-scoped records without private data",()=>{
 const api=read("app/api/public-plot-notices/route.ts");
 assert.match(api,/publicProjectId\(req\)/);
 assert.match(api,/publicSiteEnabled\(projectId\)/);
 assert.match(api,/state='published'/);
 assert.match(api,/row\?\.enabled!==1/);
 assert.match(api,/project_id=\?/);
 assert.doesNotMatch(api,/buyer|broker|owner|amount/);
});
test("client admin can publish without Super Admin; public map unchanged",()=>{
 const api=read("app/api/client/plot-notices/route.ts");
 assert.match(api,/export async function PATCH/);
 assert.match(api,/await actor\(\)/);
 assert.match(api,/session\.projectId/);
 assert.doesNotMatch(api,/requireSuperAdmin/);
 const dashboard=read("app/admin-dashboard.tsx");
 assert.match(dashboard,/Plot Updates/);
 assert.match(dashboard,/tab==="notices"&&plotUpdatesEnabled/);
 const page=read("public/project/index.html");
 assert.match(page,/REKIXO_PROJECT_PLOT_NEWS_V1/);
 assert.match(page,/plot-news-banner\.is-shown/);
 assert.match(page,/prefers-reduced-motion:reduce/);
 assert.match(page,/REKIXO_PLOT_NOTICES_INIT\?\.\(data\)/);
 assert.match(page,/plotNewsHistory/);
 assert.doesNotMatch(api,/UPDATE plots SET|UPDATE property_sales SET/);
});
test("plot mutations create private draft candidates only",()=>{
 const service=read("app/project-plot-notices.ts");
 assert.match(service,/INSERT OR IGNORE INTO project_plot_notices/);
 assert.match(service,/'draft','automatic'/);
 assert.match(read("app/api/data/route.ts"),/recordPrivatePlotNotice/);
 assert.match(read("app/api/client/deal-progress/route.ts"),/recordPrivatePlotNotice/);
 const ui=read("app/client-plot-notice-drafts.tsx");
 assert.match(ui,/changeNoticeState/);
 assert.match(ui,/Publish/);
 assert.match(ui,/Unpublish/);
 assert.match(ui,/Hide/);
});
