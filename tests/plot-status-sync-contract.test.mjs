import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("every admin role uses the dedicated verified status mutation path", () => {
  const dashboard = read("app/admin-dashboard.tsx");
  assert.match(
    dashboard,
    /type:\"plotStatus\",projectId,plotId:plot\.id,status,expectedStatus:previous/,
  );
  assert.doesNotMatch(
    dashboard,
    /user\.role===\"client_admin\"\?\{type:\"plotStatus\"/,
  );
  assert.match(dashboard, /if\(data\.status!==status\)throw new Error\(\"Saved status verify nahi hua\"\)/);
  assert.match(dashboard, /value=\"available\">Available/);
  assert.match(dashboard, /value=\"booked\">Booked/);
  assert.match(dashboard, /value=\"sold\">Sold/);
});

test("status write is read-back verified before reporting success", () => {
  const route = read("app/api/data/route.ts");
  const statusStart = route.indexOf('if (body.type === "plotStatus")');
  const statusEnd = route.indexOf('if (session.role === "super_admin")', statusStart + 1);
  const block = route.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.match(block, /SELECT id,status,updated_at AS updatedAt FROM plots/);
  assert.match(block, /UPDATE plots\s+SET status=\?, updated_at=\?/);
  assert.match(block, /SELECT status,updated_at AS updatedAt FROM plots/);
  assert.match(block, /persisted\.status !== status/);
  assert.match(block, /x-rekixo-status-write/);
  assert.match(block, /previousStatus: existing\.status/);
  assert.match(block, /persistedStatus: persisted\.status/);
});

test("super admin status writes are project-scoped and allowed only on dedicated status path", () => {
  const route = read("app/api/data/route.ts");
  const statusAt = route.indexOf('if (body.type === "plotStatus")');
  const denyAt = route.indexOf('if (session.role === "super_admin")', statusAt + 1);
  assert.ok(statusAt >= 0 && denyAt > statusAt);
  assert.match(route, /body\.projectId \|\| body\.plot\?\.projectId/);
  assert.match(route, /SELECT id FROM projects WHERE id=\? AND status!='deleted'/);
  assert.match(route, /session\.role === "super_admin" \? requestedProjectId : session\.projectId/);
});

test("optimistic-concurrency guard prevents silent stale-session overwrites", () => {
  const route = read("app/api/data/route.ts");
  const dashboard = read("app/admin-dashboard.tsx");
  assert.match(route, /expectedStatus\?: string/);
  assert.match(route, /existing\.status !== expectedStatus/);
  assert.match(route, /currentStatus: existing\.status/);
  assert.match(route, /status: 409/);
  assert.match(dashboard, /expectedStatus:previous/);
});

test("public live state reads the same canonical plots status and is never cached", () => {
  const live = read("app/api/public-live/route.ts");
  const deploy = read("scripts/prepare-cloudflare-deploy.mjs");
  assert.match(live, /SELECT id,status,updated_at AS updatedAt FROM plots WHERE project_id=\?/);
  assert.match(live, /status:row\.status===\"booked\"\|\|row\.status===\"sold\"\?row\.status:\"available\"/);
  assert.match(live, /updatedAt:row\.updatedAt/);
  assert.match(live, /cache-control\":\"no-store/);
  assert.match(live, /x-rekixo-live-state/);
  assert.match(deploy, /\/api\/public-live\*/);
});

test("status semantic colors stay distinct: Booked yellow, Sold red", () => {
  const html = read("public/project/index.html");
  assert.match(
    html,
    /REKIXO_STATUS_THEME_DEFAULTS=\{available:'#12C568',booked:'#F5B516',sold:'#F0314C'\}/,
  );
  assert.match(html, /data-status=\"booked\"/);
  assert.match(html, /data-status=\"sold\"/);
  assert.match(html, /--plot-booked-rgb/);
  assert.match(html, /--plot-sold-rgb/);
});
