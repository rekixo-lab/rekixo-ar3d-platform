import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  clientApi,
  clientUi,
  dashboard,
  superApi,
  superUi,
  schema,
  publicApi,
  publicPage,
] = await Promise.all([
  source("../app/api/client/plot-pricing/route.ts"),
  source("../app/client-plot-pricing.tsx"),
  source("../app/admin-dashboard.tsx"),
  source("../app/api/admin/project-pricing/route.ts"),
  source("../app/project-pricing-source.tsx"),
  source("../db/schema.ts"),
  source("../app/api/public-data/route.ts"),
  source("../public/project/index.html"),
]);

test("client pricing reuses existing isolated plot_pricing table with no plot schema write", () => {
  assert.match(schema, /export const plotPricing = sqliteTable\("plot_pricing"/);
  assert.match(schema, /primaryKey\(\{columns:\[table\.projectId,table\.plotId\]\}\)/);
  assert.match(clientApi, /INSERT INTO plot_pricing/);
  assert.match(clientApi, /DELETE FROM plot_pricing WHERE project_id=\? AND plot_id=\?/);
  assert.doesNotMatch(clientApi, /UPDATE plots|INSERT INTO plots|DELETE FROM plots/);
});

test("client pricing endpoint is session-project scoped and client-admin only", () => {
  assert.match(clientApi, /validAdminSession\(\)/);
  assert.match(clientApi, /session\.role !== "client_admin"/);
  assert.match(clientApi, /const projectId = session\.projectId/);
  assert.doesNotMatch(clientApi, /body\?\.projectId|body\.projectId/);
  assert.match(clientApi, /sameOrigin\(request\)/);
  assert.match(clientApi, /SELECT id FROM plots WHERE project_id=\? AND id IN/);
  assert.match(clientApi, /Unknown plot selection/);
});

test("client pricing requires both project pricing and explicit Super Admin permission", () => {
  assert.match(clientApi, /pricingEnabled/);
  assert.match(clientApi, /clientPricingEditEnabled/);
  assert.match(clientApi, /!access\.enabled \|\| !access\.editable/);
  assert.match(superApi, /clientPricingEditEnabled/);
  assert.match(superApi, /project\.client_pricing_permission_updated/);
  assert.match(superApi, /clientPricingEditDisabled: body\?\.enabled === false/);
});

test("Super Admin pricing card controls client permission and warns before replacing client edits", () => {
  assert.match(superUi, /Allow Client Admin to edit pricing/);
  assert.match(superUi, /clientEditable/);
  assert.match(superUi, /source === "client"/);
  assert.match(superUi, /replace karegi/);
  assert.match(superApi, /pricingLastEditSource/);
  assert.match(superApi, /settingUpsert\(projectId, PRICING_SOURCE_KEY, "sheet", now\)/);
});

test("client dashboard keeps full plot editor Super Admin-only and mounts isolated pricing editor", () => {
  assert.match(dashboard, /import ClientPlotPricing from "\.\/client-plot-pricing";/);
  assert.match(dashboard, /selected&&user\.role==="super_admin"/);
  assert.match(
    dashboard,
    /user\.role==="client_admin"&&<ClientPlotPricing notify=\{show\}\/>/,
  );
  assert.match(dashboard, /type:"plotStatus"/);
});

test("client pricing UI supports single and bulk selection, rate units, fixed price and automatic base preview", () => {
  assert.match(clientUi, /Select page/);
  assert.match(clientUi, /PRICING_PAGE_SIZE = 250/);
  assert.match(clientUi, /plots\.map/);
  assert.match(clientUi, /offset: String\(page \* PRICING_PAGE_SIZE\)/);
  assert.match(clientUi, /params\.set\("q", query\.trim\(\)\)/);
  assert.match(clientUi, /Page \{page \+ 1\} \/ \{pageCount\}/);
  assert.match(clientUi, /Clear selection/);
  assert.match(clientUi, /type="checkbox"/);
  assert.match(clientUi, /Rate × Area/);
  assert.match(clientUi, /Sq\. Yards/);
  assert.match(clientUi, /Sq\. Feet/);
  assert.match(clientUi, /Sq\. Meters/);
  assert.match(clientUi, /Fixed Price/);
  assert.match(clientUi, /const area = Number\(plot\[unit\]\)/);
  assert.match(clientUi, /area \* unitRate/);
  assert.match(clientUi, /Automatic Base Price Preview/);
  assert.match(clientUi, /Apply to/);
  assert.match(clientUi, /Remove Price/);
});

test("client pricing keeps the shared API path and never exposes raw browser network errors", () => {
  assert.match(clientUi, /fetch\("\/api\/client\/plot-pricing"/);
  assert.match(clientUi, /function pricingErrorMessage/);
  assert.match(clientUi, /networkerror\|failed to fetch\|network request failed\|load failed/i);
  assert.match(clientUi, /Pricing service se connection nahi ho paaya\. Dobara try karein\./);
  assert.doesNotMatch(clientUi, /notify\(error instanceof Error \? error\.message : "Pricing load nahi hui"\)/);
});

test("bulk writes validate selection and record only client pricing audit events", () => {
  assert.match(clientApi, /MAX_SELECTION = 1000/);
  assert.match(clientApi, /project\.client_pricing_updated/);
  assert.match(clientApi, /project\.client_pricing_removed/);
  assert.match(clientApi, /pricingLastEditSource/);
  assert.match(clientApi, /settingUpsert\(projectId, PRICING_SOURCE_KEY, "client", now\)/);
});

test("public pricing contract stays unchanged and client permission never leaks publicly", () => {
  assert.match(publicApi, /const pricingEnabled = publicSettings\.pricingEnabled === "1"/);
  assert.match(publicApi, /plotPricing/);
  assert.doesNotMatch(publicApi, /clientPricingEditEnabled|pricingLastEditSource/);
  assert.match(publicPage, /const area=Number\(p\[unit\]\)/);
  assert.match(publicPage, /const base=area\*rate/);
});
