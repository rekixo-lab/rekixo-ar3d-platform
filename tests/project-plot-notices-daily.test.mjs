import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=(p)=>readFileSync(p,"utf8");

test("same plot's multiple same-day changes replace the public label, not duplicate it",()=>{
 const s=source("app/project-plot-notices.ts");
 assert.match(s,/const stableId="auto:"\+eventDate\+":"\+category\+":"\+plotId/);
 assert.match(s,/UPDATE project_plot_notices SET label=\?,state='published'/);
 assert.match(s,/WHERE project_id=\? AND event_date=\? AND category=\? AND plot_ids_json=\?/);
 assert.match(s,/source='automatic' AND state IN \('draft','published'\)/);
 assert.match(s,/WHERE NOT EXISTS \(SELECT 1 FROM project_plot_notices/);
 assert.match(s,/source='automatic'\)"/);
 assert.match(s,/project_plot_notice_settings WHERE project_id=\? AND enabled=1/);
 assert.match(s,/plots WHERE project_id=\? AND id=\? AND inventory_active=1/);
 assert.doesNotMatch(s,/UPDATE plots SET|UPDATE property_sales|INSERT INTO sales_payments/);
});

test("only today's Asia Kolkata notices are public even at midnight; old dates are private history",()=>{
 const api=source("app/api/public-plot-notices/route.ts");
 const page=source("public/project/index.html");
 assert.match(api,/indiaDate\(new Date\(\)\.toISOString\(\)\)/);
 assert.match(api,/state='published' AND event_date=\?/);
 assert.match(api,/\.bind\(projectId,today\)/);
 assert.match(api,/cache-control":"no-store"/);
 assert.match(page,/const todayIndia=\(\)=>new Date\(Date\.now\(\)\+330\*60000\)/);
 assert.match(page,/notice\.eventDate!==todayIndia\(\)/);
 assert.match(page,/groups\[0\]\.date!==todayIndia\(\)/);
 assert.match(page,/\},15000\)/);
 // These ISO timestamps straddle midnight India date.
 const convert=iso=>new Date(new Date(iso).getTime()+330*60*1000).toISOString().slice(0,10);
 assert.equal(convert("2026-10-28T18:29:59.000Z"),"2026-10-28");
 assert.equal(convert("2026-10-28T18:30:00.000Z"),"2026-10-29");
});

test("only safe customer-visible status names and ids may be published automatically",()=>{
 const s=source("app/project-plot-notices.ts");
 assert.match(s,/inventoryLabels:Record<string,string>/);
 assert.match(s,/dealLabels:Record<string,string>/);
 assert.match(s,/dealLabels\[key\]\|\|"Plot Updated"/);
 assert.match(s,/plotIdsJson=JSON\.stringify\(\[plotId\]\)/);
 assert.doesNotMatch(source("app/api/public-plot-notices/route.ts"),/buyer|owner|broker|notes|amount|created_by|actorId/);
 assert.match(source("app/api/data/route.ts"),/if\(existing\.status!==status\)await recordAutomaticPlotNotice/);
 assert.match(source("app/api/client/deal-progress/route.ts"),/recordAutomaticPlotNotice/);
 assert.match(source("app/api/client/sales/route.ts"),/recordAutomaticPlotNotice/);
 assert.match(source("app/api/client/deal-progress/route.ts"),/fieldKey===METRO_AGREEMENT_FIELD/);
 assert.match(source("app/api/client/metro-status/route.ts"),/recordAutomaticPlotNotice/);
});

test("admins retain hide/unpublish and custom manual notices, feature default is off for other tenants",()=>{
 const client=source("app/api/client/plot-notices/route.ts");
 const ui=source("app/client-plot-notice-drafts.tsx");
 const schema=source("drizzle/0042_project_plot_notices.sql");
 assert.match(client,/\["published","draft","hidden"\]/);
 assert.match(ui,/Custom Announcement \(only when needed\)/);
 assert.match(ui,/AUTO-PUBLISHED/);
 assert.match(schema,/enabled INTEGER NOT NULL DEFAULT 0/);
 assert.match(schema,/WHERE id='c024a562-634d-4e49-b647-43209f6e450b'/);
});
