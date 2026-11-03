import { readFile, writeFile } from "node:fs/promises";

const path = "dist/server/wrangler.json";
const config = JSON.parse(await readFile(path, "utf8"));
const mode = process.argv[2];

if (!["client", "legacy", "super"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/prepare-cloudflare-deploy.mjs client|legacy|super",
  );
}

const workersSubdomain =
  String(process.env.REKIXO_WORKERS_SUBDOMAIN || "").trim() || "ai-8f3";
const genericHost = `rekixo-client-sites.${workersSubdomain}.workers.dev`;
const legacyHost = `tiyansh-prime-square.${workersSubdomain}.workers.dev`;
const platformHost = String(process.env.REKIXO_PLATFORM_HOST || "")
  .trim()
  .toLowerCase()
  .replace(/\.$/, "");
const sharedAdminHost = String(
  process.env.REKIXO_SHARED_ADMIN_HOST || "",
)
  .trim()
  .toLowerCase()
  .replace(/\.$/, "");

config.name =
  mode === "super"
    ? "rekixo-super-admin"
    : mode === "legacy"
      ? "tiyansh-prime-square"
      : "rekixo-client-sites";

config.vars = {
  PANEL_MODE: mode === "super" ? "super" : "client",
  SUPER_ADMIN_HOST: "admin.rekixo.com",
  CLIENT_FALLBACK_HOST: genericHost,
  LEGACY_FALLBACK_HOST: legacyHost,
  CLIENT_PLATFORM_HOST: platformHost,
  CLIENT_SHARED_ADMIN_HOST: sharedAdminHost,
  CLIENT_ADMIN_ORIGIN: sharedAdminHost
    ? `https://${sharedAdminHost}`
    : `https://${genericHost}`,
};

// Keep Platform and Engine data stores isolated, but use Cloudflare-native
// service bindings for reliable Worker-to-Worker HTTP calls. These are additive:
// external HTTPS fallbacks remain in engine-integration.ts for local/dev and
// rollback compatibility.
config.services = [
  {
    binding: "AR3D_ENGINE_ADMIN_SERVICE",
    service: "rekixo-3d-admin",
  },
  {
    binding: "AR3D_ENGINE_PUBLIC_SERVICE",
    service: "rekixo-3d-public",
  },
];

// IMPORTANT: shared boss domain gets only the exact Rekixo surface.
// Never attach a host-wide wildcard here: unmatched boss-site traffic must
// continue to the existing Vercel origin.
const sharedDomainRoutes = platformHost
  ? [
      `${platformHost}/projects/*`,
      `${platformHost}/__rekixo/*`,
      `${platformHost}/api/public-data*`,
      // Customer-facing runtime state must stay on the same Generic Client Worker.
      // Status/pricing are intentionally live (no Publish Update), while gallery is
      // loaded lazily from the public shell. Keep these explicit on the shared host.
      `${platformHost}/api/public-live*`,
      `${platformHost}/api/public-plot-notices*`,
      `${platformHost}/api/public-gallery*`,
      // Customer Satellite Map data + promoted transparent masterplan asset.
      // Prefix wildcard keeps projectSlug/token query strings on the Client Worker.
      `${platformHost}/api/public-geo*`,
      `${platformHost}/api/project-asset/*`,
      `${platformHost}/api/admin/*`,
      // Client-admin-only feature APIs must stay on the Generic Client Worker.
      // Without this explicit route, the shared boss/Vercel origin receives
      // requests such as /api/client/plot-pricing and browser fetch fails.
      `${platformHost}/api/client/*`,
      `${platformHost}/api/data*`,
      `${platformHost}/api/gallery*`,
    ]
  : [];

if (mode === "client" && sharedDomainRoutes.length) {
  config.routes = sharedDomainRoutes.map((pattern) => ({
    pattern,
    zone_name: platformHost,
  }));
} else {
  // dist/server/wrangler.json is reused by the sequential deploy steps.
  // Remove client routes before legacy/super deploys so they can never steal
  // ar3dstudio.in traffic from rekixo-client-sites.
  delete config.routes;
}



// A Wrangler deploy normally reconciles routes from this generated file.
// Preserve already attached Cloudflare Custom Domains rather than deleting them
// during the next routine deployment of the shared customer Worker.
if (mode === "client" && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const domains = [];
  for (let page = 1; page <= 20; page++) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`);
    url.searchParams.set("service", "rekixo-client-sites");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.result)) {
      throw new Error("Cloudflare domain inventory unavailable; refusing deploy that could detach customer domains");
    }
    domains.push(...data.result);
    const pageCount = Number(data.result_info?.total_pages || page);
    if (page >= pageCount) break;
    if (page === 20) throw new Error("Cloudflare custom domain inventory pagination exceeded");
  }
  const existing = new Set((config.routes || []).map((route) => route.pattern));
  const customRoutes = domains
    .filter((domain) => domain.service === "rekixo-client-sites" && domain.enabled && domain.hostname)
    .map((domain) => ({ pattern: String(domain.hostname).toLowerCase(), custom_domain: true }))
    .filter((route) => !existing.has(route.pattern));
  config.routes = [...(config.routes || []), ...customRoutes];
  console.log(`Preserved ${customRoutes.length} existing customer Custom Domains`);
}

config.d1_databases = [
  {
    binding: "DB",
    database_name: "tiyansh-production",
    database_id: "ac37f422-3065-4bda-9f9c-16c4b818cacd",
  },
];

config.r2_buckets = [
  {
    binding: "BUCKET",
    bucket_name: "tiyansh-gallery-production",
  },
];

// Geo public promotion uses the Images binding to create immutable mobile and
// desktop WebP derivatives directly from the R2 masterplan source.
config.images = { binding: "IMAGES" };

await writeFile(path, `${JSON.stringify(config)}\n`);
console.log(
  `Prepared ${mode} Worker: ${config.name} · shared D1/R2 · Images · platform ${platformHost}` +
    (mode === "client" && sharedDomainRoutes.length
      ? ` · routes ${sharedDomainRoutes.length}`
      : ""),
);
