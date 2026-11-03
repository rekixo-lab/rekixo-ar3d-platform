import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("unified domain is only for Future Invest Realty with an existing active admin", () => {
  const route = read("app/api/admin/users/route.ts");
  const segment = route.slice(route.indexOf('if(body.action==="connect_existing_domain")'),
    route.indexOf("  const name=String(body.name",route.indexOf('if(body.action==="connect_existing_domain")')));
  assert.ok(segment.includes("projectId!==FUTURE_INVEST_REALTY_ID"));
  assert.ok(segment.includes("role='client_admin' AND status='active'"));
  assert.ok(segment.includes("project.publicStatus!==\"published\""));
  assert.ok(segment.includes("await assertDomainAvailable(host,projectId)"));
  assert.ok(segment.includes("attachCustomerWorkerDomain(host)"));
  assert.ok(segment.includes("upsertUnifiedProjectDomain(projectId,host)"));
  assert.ok(segment.includes("existingAdminReused:true"));
  assert.doesNotMatch(segment, /INSERT INTO admin_users|hashAdminPassword|provisionClientAccess/);
  assert.ok(segment.includes("https://${host}/admin"));
});
test("a single transaction maps both public and admin hosts without remapping plots", () => {
  const src=read("app/project-domains.ts");
  const unified=src.slice(src.indexOf("export async function upsertUnifiedProjectDomain("));
  assert.ok(unified.includes("await assertDomainAvailable(hostValue, projectId)"));
  assert.ok(unified.includes("public_primary=0,admin_primary=0"));
  assert.ok(unified.includes("kind='both',status='active',public_primary=1,admin_primary=1"));
  assert.ok(unified.includes("'both',1,1,'active'"));
  assert.ok(unified.includes("SET public_host=?,admin_host=?,updated_at=?"));
  assert.ok(unified.includes("await env.DB.batch(statements)"));
  assert.doesNotMatch(unified, /DELETE FROM plots|UPDATE plots|DELETE FROM admin_users/);
});
test("admin login is tenant scoped on the new domain", () => {
  const login=read("app/admin/login/page.tsx");
  const form=read("app/admin/login/login-form.tsx");
  const auth=read("app/admin-auth.ts");
  assert.ok(login.includes("projectHostRole(host)"));
  assert.ok(login.includes("projectId={domainProjectId}"));
  assert.ok(login.includes("projectName={domainProjectName}"));
  assert.ok(form.includes('successPath = "/admin"'));
  assert.ok(auth.includes("clientAdminHostAllowed(row.projectId,row.adminHost,host)"));
  assert.ok(auth.includes("kind IN ('admin','both')"));
});
test("UI domain-only flow never creates another client account", () => {
  const ui=read("app/client-admin-manager.tsx");
  assert.ok(ui.includes("selectedProject?.adminCount"));
  assert.ok(ui.includes("reuseExistingAdmin"));
  assert.ok(ui.includes('action: "connect_existing_domain"'));
  assert.ok(ui.includes('unifiedDomainMode ? "Connect Customer Domain"'));
  assert.ok(ui.includes("Existing admin रहेगा"));
  assert.ok(ui.includes("cloudflareStatus"));
});
test("Cloudflare API is optional and generated Worker config keeps custom domains", () => {
  const provision=read("app/cloudflare-domain-provisioning.ts");
  const prepare=read("scripts/prepare-cloudflare-deploy.mjs");
  const workflow=read(".github/workflows/deploy-cloudflare.yml");
  assert.ok(provision.includes("CLOUDFLARE_DOMAIN_API_TOKEN"));
  assert.ok(provision.includes('service: "rekixo-client-sites"'));
  assert.ok(provision.includes('"manual_required"'));
  assert.ok(provision.includes('service !== "rekixo-client-sites"'));
  assert.ok(prepare.includes('custom_domain: true'));
  assert.ok(prepare.includes('domain.service === "rekixo-client-sites"'));
  assert.ok(prepare.includes("refusing deploy that could detach customer domains"));
  assert.ok(workflow.includes("CLOUDFLARE_DOMAIN_API_TOKEN"));
});
test("customer-facing API returns same domain /admin for Future Invest only",()=>{
  const api=read("app/api/public-data/route.ts");
  assert.ok(api.includes("projectId===FUTURE_INVEST_REALTY_ID"));
  assert.ok(api.includes("project.publicHost===project.adminHost"));
  assert.ok(api.includes("adminUrl: customerAdminUrl"));
});
