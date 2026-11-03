import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("shared public domain delegates clean project links to the canonical helper", async () => {
  const [page, publicData, domains] = await Promise.all([
    source("../app/projects/[slug]/page.tsx"),
    source("../app/api/public-data/route.ts"),
    source("../app/api/admin/domains/route.ts"),
  ]);
  assert.match(page, /projectBySlug/);
  assert.match(page, /projectSlug=/);
  // URL construction now belongs to app/project-links.ts. These route-level
  // checks intentionally verify delegation instead of duplicating helper internals.
  assert.match(publicData, /currentProjectLinks/);
  assert.match(publicData, /adminUrl:\\s*customerAdminUrl/);
  assert.match(publicData, /:\\s*links\\.adminUrl/);
  assert.match(publicData, /projectId===FUTURE_INVEST_REALTY_ID/);
  assert.match(publicData, /platformUrl:\s*links\.platformUrl/);
  assert.match(domains, /currentProjectLinks/);
  assert.doesNotMatch(domains, /\/p\/\$\{encodeURIComponent\(slug\)\}/);
});

test("project admin login is path-scoped and cannot cross tenants", async () => {
  const [auth, api, login, dashboard] = await Promise.all([
    source("../app/admin-auth.ts"),
    source("../app/api/admin/login/route.ts"),
    source("../app/projects/[slug]/admin-login/page.tsx"),
    source("../app/projects/[slug]/admin/page.tsx"),
  ]);
  assert.match(auth, /requestedProjectSlug/);
  assert.match(auth, /row\.projectSlug/);
  assert.match(api, /projectSlug/);
  assert.match(login, /projectId=\{project\.id\}/);
  assert.match(dashboard, /session\.projectId !== project\.id/);
});

test("Rekixo Super Admin remains isolated from shared customer project routes", async () => {
  const [publicPage, loginPage, adminPage, mapper] = await Promise.all([
    source("../app/projects/[slug]/page.tsx"),
    source("../app/projects/[slug]/admin-login/page.tsx"),
    source("../app/projects/[slug]/admin/page.tsx"),
    source("../app/api/mapper/route.ts"),
  ]);
  assert.match(publicPage, /panelMode\(\) === "super"/);
  assert.match(loginPage, /panelMode\(\) === "super"/);
  assert.match(adminPage, /panelMode\(\) === "super"/);
  assert.match(mapper, /only in Rekixo Super Admin/);
});

test("client login, password change and logout preserve project path", async () => {
  const [form, password, logout] = await Promise.all([
    source("../app/admin/login/login-form.tsx"),
    source("../app/admin/change-password/password-form.tsx"),
    source("../app/api/admin/logout/route.ts"),
  ]);
  assert.match(form, /successPath/);
  assert.match(form, /changePasswordPath/);
  assert.match(password, /successPath/);
  assert.match(logout, /returnTo/);
  assert.match(logout, /!returnTo\.startsWith\("\/\/"\)/);
});
