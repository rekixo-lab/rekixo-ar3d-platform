import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");
const [dashboard,dataApi,pricing,pricingApi,manager,users,css]=await Promise.all([
  read("../app/admin-dashboard.tsx"),
  read("../app/api/data/route.ts"),
  read("../app/client-plot-pricing.tsx"),
  read("../app/api/client/plot-pricing/route.ts"),
  read("../app/client-admin-manager.tsx"),
  read("../app/api/admin/users/route.ts"),
  read("../app/globals.css"),
]);

test("Client Admin plot inventory is server-paged and searchable rather than fully downloaded",()=>{
  assert.match(dashboard,/PLOT_PAGE_SIZE=250/);
  assert.match(dashboard,/section:"plots"/);
  assert.match(dashboard,/offset:String\(plotPage\*PLOT_PAGE_SIZE\)/);
  assert.match(dashboard,/params\.set\("q",plotSearch\.trim\(\)\)/);
  assert.match(dashboard,/setPlotTotal/);
  assert.match(dashboard,/plots\.map/);
  assert.doesNotMatch(dashboard,/fetch\("\/api\/data",\{cache:"no-store"/);

  assert.match(dataApi,/section === "plots"/);
  assert.match(dataApi,/\.limit\(limit\)\.offset\(offset\)/);
  assert.match(dataApi,/SELECT COUNT\(\*\) AS total FROM plots WHERE project_id=\? AND id LIKE \?/);
  assert.match(dataApi,/GROUP BY status/);
  assert.match(css,/REKIXO_ADMIN_LIST_PAGER_V1/);
});

test("client pricing pages joined inventory and pricing on the server",()=>{
  assert.match(pricing,/PRICING_PAGE_SIZE = 250/);
  assert.match(pricing,/offset: String\(page \* PRICING_PAGE_SIZE\)/);
  assert.match(pricing,/params\.set\("q", query\.trim\(\)\)/);
  assert.match(pricing,/plots\.map/);
  assert.doesNotMatch(pricing,/filteredPlots/);
  assert.match(pricingApi,/LEFT JOIN plot_pricing/);
  assert.match(pricingApi,/LIMIT \? OFFSET \?/);
  assert.match(pricingApi,/pricedCount/);
  assert.match(pricingApi,/existingPlotIds/);
  assert.match(pricingApi,/index \+= 80/);
  assert.doesNotMatch(pricingApi,/SELECT id FROM plots WHERE project_id=\? ORDER BY id/);
});

test("Super Admin project selectors and archives use bounded server queries",()=>{
  assert.match(users,/section==="project_options"/);
  assert.match(users,/LIMIT \?"/);
  assert.match(users,/section==="archived"/);
  assert.match(users,/LIMIT \? OFFSET \?/);
  assert.match(manager,/Project name search/);
  assert.match(manager,/section=project_options&limit=50/);
  assert.match(manager,/section=archived&limit=/);
  assert.match(manager,/ARCHIVE_PAGE_SIZE = 8/);
});

test("summary endpoint is counts-only rather than full project inventory",()=>{
  const start=users.indexOf('if(section==="summary")');
  const end=users.indexOf('if(section==="project_options")',start);
  const block=users.slice(start,end);
  assert.match(block,/projectCount/);
  assert.match(block,/archivedCount/);
  assert.doesNotMatch(block,/projectQuery/);
  assert.doesNotMatch(block,/archivedQuery/);
});
