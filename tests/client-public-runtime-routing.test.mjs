import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [deploy, publicShell, publicLive, dataApi, pricingUi, smoke] =
  await Promise.all([
    source("../scripts/prepare-cloudflare-deploy.mjs"),
    source("../public/project/index.html"),
    source("../app/api/public-live/route.ts"),
    source("../app/api/data/route.ts"),
    source("../app/client-plot-pricing.tsx"),
    source("../scripts/verify-tiyansh-generic-parity.mjs"),
  ]);

function literalPublicApiFetches(html) {
  const paths = new Set();
  for (const match of html.matchAll(/fetch\(\s*["'`](\/api\/public-[^"'\`?+]+)["'`]/g)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

function sharedApiRoutes(script) {
  const routes = [];
  for (const match of script.matchAll(/\`\$\{platformHost\}(\/api\/[^\`]+)\`/g)) {
    routes.push(match[1]);
  }
  return routes;
}

function covered(path, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith("*")
      ? path.startsWith(pattern.slice(0, -1))
      : path === pattern,
  );
}

test("every customer-shell public API fetch is explicitly routed to Generic Client Worker", () => {
  const fetches = literalPublicApiFetches(publicShell);
  const routes = sharedApiRoutes(deploy);
  assert.deepEqual(
    fetches,
    ["/api/public-data", "/api/public-gallery", "/api/public-live"],
  );
  for (const path of fetches) {
    assert.ok(
      covered(path, routes),
      `shared ar3dstudio.in route missing for ${path}; add it before shipping a new customer-shell fetch`,
    );
  }
});

test("client admin mutation and public live reader share the same project-scoped canonical status source", () => {
  assert.match(dataApi, /body\.type === "plotStatus"/);
  assert.match(dataApi, /validClientPlotStatus\(status\)/);
  assert.match(
    dataApi,
    /UPDATE plots\s+SET status=\?, updated_at=\?[\s\S]*WHERE project_id=\? AND id=\?/,
  );
  assert.match(publicLive, /SELECT id,status,updated_at AS updatedAt FROM plots WHERE project_id=\?/);
  assert.match(publicLive, /updatedAt:row\.updatedAt/);
  assert.match(publicLive, /"x-rekixo-live-state":"1"/);
  assert.match(publicLive, /"cache-control":"no-store"/);
});

test("production parity smoke test fails deploy verification if public-live escapes routing", () => {
  assert.match(smoke, /verifyPublicLive/);
  assert.match(smoke, /\/api\/public-live/);
  assert.match(smoke, /x-rekixo-live-state/);
  assert.match(smoke, /public-live escaped Generic Client Worker/);
});

test("pricing side panel does not turn intentional request aborts into false connection errors", () => {
  assert.match(pricingUi, /const notifyRef = useRef\(notify\)/);
  assert.match(pricingUi, /notifyRef\.current = notify/);
  assert.match(pricingUi, /controller\.signal\.aborted/);
  assert.match(pricingUi, /notifyRef\.current\(pricingErrorMessage/);
  assert.match(pricingUi, /\}, \[page, query, refreshKey\]\);/);
  assert.doesNotMatch(pricingUi, /\}, \[notify, page, query, refreshKey\]\);/);
});
