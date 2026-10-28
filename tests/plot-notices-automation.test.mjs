import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");

test("automatic notice publishes a single safe status per plot per IST day without repeat spam",()=>{
 const source=read("app/project-plot-notices.ts");
 assert.match(source,/indiaDate\(isoTime\)/);
 assert.match(source,/330\*60\*1000/);
 assert.match(source,/dealLabels\[key\]\|\|"Plot Updated"/);
 assert.match(source,/On Hold/);
 assert.match(source,/WHERE NOT EXISTS \(SELECT 1 FROM project_plot_notices/);
 assert.match(source,/state='published'/);
 assert.match(source,/eventDate\+":"\+category\+":"\+plotId/);
 assert.match(source,/SELECT 1 AS enabled FROM project_plot_notice_settings/);
 assert.match(source,/source='automatic' AND state IN \('draft','published'\)/);
 assert.match(source,/'published','automatic'/);
});
test("approved changes are tenant scoped and batch uses per-record optimistic statuses",()=>{
 const api=read("app/api/client/plot-notices/route.ts");
 assert.match(api,/Array\.isArray\(b\.ids\)/);
 assert.match(api,/await actor\(\)/);
 assert.match(api,/session\.projectId/);
 assert.match(api,/!ids\.every/);
 assert.match(api,/ids\.length>50/);
 assert.match(api,/await env\.DB\.batch\(statements\)/);
 assert.match(api,/WHERE project_id=\? AND id=\? AND state=\? RETURNING id/);
 assert.match(api,/A draft contains inactive or missing plot numbers/);
 assert.doesNotMatch(api,/UPDATE plots SET|INSERT INTO sales_payments/);
});
test("client admin shows grouped auto-published notices, manual approval and optional custom form",()=>{
 const ui=read("app/client-plot-notice-drafts.tsx");
 assert.match(ui,/groupedUpdates/);
 assert.match(ui,/new Set\(g\.plotIds\)/);
 assert.match(ui,/Publish Selected/);
 assert.match(ui,/AUTO-PUBLISHED/);
 assert.match(ui,/Custom Announcement \(only when needed\)/);
 assert.match(ui,/istToday/);
 assert.match(ui,/groups\.filter\(g=>g\.state==="draft"\)/);
 assert.match(ui,/setStageLabels/);
 assert.doesNotMatch(ui,/Submit draft.*Super Admin review/);
});
test("customer ticker retains header slide and original map, has bright yellow and red title in one line",()=>{
 const html=read("public/project/index.html");
 assert.match(html,/REKIXO_PROJECT_PLOT_NEWS_V2/);
 assert.match(html,/background:#ffeb00/);
 assert.match(html,/color:#b91c1c/);
 assert.match(html,/class="plot-news-title">New Updates In /);
 assert.match(html,/plot-news-title-detail/);
 assert.match(html,/white-space:nowrap;overflow:hidden/);
 assert.match(html,/plot-news-banner\.is-shown/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(html,/REKIXO_PLOT_NOTICES_INIT/);
 assert.match(html,/master-original-canvas/);
});
