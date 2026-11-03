import { env, waitUntil } from "cloudflare:workers";
import { projectBySlug } from "@/modules/public-project";
import { isFutureInvestRealty, publicSafeText } from "@/app/customer-direction-policy";
import {
  buildGeoPublicManifest,
  parseGeoPublicManifest,
  type GeoPublicManifest,
  type GeoPublicSnapshot,
} from "@/modules/geo";
import { publicGoogleMapsBrowserKey } from "@/modules/geo";
import {
  publicSiteEnabled,
  publicSiteUnavailableResponse,
} from "@/modules/public-site-access";

const LIVE_SETTING_KEYS = [
  "geoPublicEnabled",
  "geoPublicLabProjectId",
  "geoPublicRevision",
  "geoPublicOverlayKey",
  "geoPublicManifestKey",
  "geoPublicOverlayMobileKey",
  "geoPublicOverlayDesktopKey",
  "geoPublicToken",
  "geoPublicPlotClicks",
  "geoPublicShowLegend",
  "geoPublicShowPolygons",
  "geoPublicViewMode",
] as const;

const manifestMemory = new Map<string, GeoPublicManifest>();
const MAX_HOT_MANIFESTS = 12;

function rememberManifest(key: string, manifest: GeoPublicManifest) {
  manifestMemory.delete(key);
  manifestMemory.set(key, manifest);
  while (manifestMemory.size > MAX_HOT_MANIFESTS) {
    const oldest = manifestMemory.keys().next().value as string | undefined;
    if (!oldest) break;
    manifestMemory.delete(oldest);
  }
}

function edgeCache() {
  return (caches as unknown as { default: Cache }).default;
}

function publicGeoCacheKey(request: Request, slug: string, projectId: string) {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("projectSlug", slug);
  if (isFutureInvestRealty(projectId)) url.searchParams.set("displayPolicy", "hide-south-v1");
  return new Request(url.toString(), { method: "GET" });
}

async function sourceLiveSettings(projectId: string) {
  const rows = await env.DB.prepare(
    `SELECT key,value FROM settings WHERE project_id=? AND key IN (${LIVE_SETTING_KEYS.map(() => "?").join(",")})`,
  )
    .bind(projectId, ...LIVE_SETTING_KEYS)
    .all<{ key: string; value: string }>();
  return new Map(rows.results.map((row) => [row.key, row.value]));
}

async function validLabLink(sourceProjectId: string, labProjectId: string) {
  const rows = await env.DB.prepare(
    "SELECT key,value FROM settings WHERE project_id=? AND key IN ('geoLabMode','geoLabSourceProjectId')",
  )
    .bind(labProjectId)
    .all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  return values.get("geoLabMode") === "1" && values.get("geoLabSourceProjectId") === sourceProjectId;
}

function statusValue(value: string) {
  const normalized = String(value || "available").toLowerCase();
  if (normalized === "sold") return "sold" as const;
  if (normalized === "booked" || normalized === "hold") return "booked" as const;
  return "available" as const;
}

function promotedKeyAllowed(key: string, labProjectId: string) {
  return key.startsWith(`projects/${labProjectId}/geo/promoted/`);
}

async function loadPublicManifest(options: {
  labProjectId: string;
  revision: number;
  overlayKey: string;
  configuredManifestKey: string;
}) {
  const fallbackKey = `${options.overlayKey}.manifest.json`;
  const candidate =
    options.configuredManifestKey && promotedKeyAllowed(options.configuredManifestKey, options.labProjectId)
      ? options.configuredManifestKey
      : fallbackKey;

  const hot = manifestMemory.get(candidate);
  if (hot && hot.revision === options.revision) {
    rememberManifest(candidate, hot);
    return { manifest: hot, source: "memory" as const };
  }

  if (promotedKeyAllowed(candidate, options.labProjectId)) {
    const object = await env.BUCKET.get(candidate);
    if (object) {
      try {
        const manifest = parseGeoPublicManifest(await object.text(), options.revision);
        rememberManifest(candidate, manifest);
        return { manifest, source: "r2" as const };
      } catch (error) {
        console.warn("Cached Geo public manifest invalid, rebuilding", error);
      }
    }
  }

  const version = await env.DB.prepare(
    "SELECT snapshot FROM geo_versions WHERE project_id=? AND version=? LIMIT 1",
  )
    .bind(options.labProjectId, options.revision)
    .first<{ snapshot: string }>();
  if (!version?.snapshot) throw new Error("Published Geo snapshot unavailable");

  const manifest = buildGeoPublicManifest(JSON.parse(version.snapshot) as GeoPublicSnapshot, options.revision);
  rememberManifest(candidate, manifest);
  if (promotedKeyAllowed(candidate, options.labProjectId)) {
    waitUntil(
      env.BUCKET.put(candidate, JSON.stringify(manifest), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          geoRevision: String(options.revision),
          schemaVersion: String(manifest.schemaVersion),
          backfilled: "1",
        },
      }).catch((error) => {
        console.warn("Geo public manifest backfill skipped", error);
      }),
    );
  }
  return { manifest, source: "computed" as const };
}

function decorateManifest(
  projectId: string,
  manifest: GeoPublicManifest,
  plots: Array<{
    id: string;
    status: string;
    sqft: number;
    sqm: number;
    sqyd: number;
    dimensions: string;
    road: string;
  }>,
) {
  const plotsById = new Map(plots.map((plot) => [plot.id, plot]));
  let available = 0;
  let booked = 0;
  let sold = 0;
  let total = 0;
  const features = manifest.features.map((feature) => {
    const plot = feature.linkedPlotId ? plotsById.get(feature.linkedPlotId) : undefined;
    const status = statusValue(plot?.status || "available");
    if (feature.linkedPlotId) {
      total += 1;
      if (status === "sold") sold += 1;
      else if (status === "booked") booked += 1;
      else available += 1;
    }
    return {
      ...feature,
      name: publicSafeText(projectId, feature.name),
      status,
      sqft: Number(plot?.sqft || 0),
      sqm: Number(plot?.sqm || 0),
      sqyd: Number(plot?.sqyd || 0),
      dimensions: publicSafeText(projectId, plot?.dimensions),
      road: publicSafeText(projectId, plot?.road),
    };
  });
  return { features, counts: { total, available, booked, sold } };
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("projectSlug")?.trim() || "";
    if (!slug) return Response.json({ error: "Project slug required" }, { status: 400 });

    const source = await projectBySlug(slug);
    if (!source) return Response.json({ error: "Published project nahi mila" }, { status: 404 });
    if (!(await publicSiteEnabled(source.id))) {
      return publicSiteUnavailableResponse();
    }

    // Access gate runs before the manual edge cache so Public Site OFF takes
    // effect immediately even if a Geo response was cached seconds earlier.
    const cache = edgeCache();
    const cacheKey = publicGeoCacheKey(request, slug, source.id);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const live = await sourceLiveSettings(source.id);
    if (live.get("geoPublicEnabled") !== "1")
      return Response.json({ error: "Satellite Geo map live nahi hai" }, { status: 404 });

    const labProjectId = String(live.get("geoPublicLabProjectId") || "");
    const revision = Number(live.get("geoPublicRevision") || 0);
    const overlayKey = String(live.get("geoPublicOverlayKey") || "");
    const manifestKey = String(live.get("geoPublicManifestKey") || "");
    const token = String(live.get("geoPublicToken") || "");
    const showPolygons = live.get("geoPublicShowPolygons") !== "0";
    const plotClicks = showPolygons && live.get("geoPublicPlotClicks") !== "0";
    const showLegend = live.get("geoPublicShowLegend") !== "0";
    const viewMode = live.get("geoPublicViewMode") === "masterplan" ? "masterplan" : "north";
    if (!labProjectId || revision < 1 || !overlayKey || !token)
      return Response.json({ error: "Geo live pointer incomplete hai" }, { status: 404 });

    if (!(await validLabLink(source.id, labProjectId)))
      return Response.json({ error: "Geo live ownership mismatch" }, { status: 404 });

    const manifestStartedAt = Date.now();
    const [manifestResult, plotRows, mapsKey] = await Promise.all([
      loadPublicManifest({ labProjectId, revision, overlayKey, configuredManifestKey: manifestKey }),
      env.DB.prepare(
        "SELECT id,status,sqft,sqm,sqyd,dimensions,road FROM plots WHERE project_id=? ORDER BY id",
      )
        .bind(source.id)
        .all<{
          id: string;
          status: string;
          sqft: number;
          sqm: number;
          sqyd: number;
          dimensions: string;
          road: string;
        }>(),
      publicGoogleMapsBrowserKey(),
    ]);
    const manifestMs = Date.now() - manifestStartedAt;
    const { features, counts } = decorateManifest(source.id, manifestResult.manifest, plotRows.results);
    const baseMasterplanUrl =
      `/api/public-geo-masterplan?projectSlug=${encodeURIComponent(source.slug)}` +
      `&v=${encodeURIComponent(token)}`;

    const response = Response.json(
      {
        schemaVersion: 2,
        project: { id: source.id, name: source.name, slug: source.slug },
        revision,
        maps: { enabled: Boolean(mapsKey), apiKey: mapsKey || null },
        display: { plotClicks, showLegend, showPolygons, viewMode },
        masterplanUrl: baseMasterplanUrl,
        masterplanUrls: {
          original: baseMasterplanUrl,
          mobile: `${baseMasterplanUrl}&variant=mobile`,
          desktop: `${baseMasterplanUrl}&variant=desktop`,
        },
        masterplanCorners: manifestResult.manifest.masterplanCorners,
        bounds: manifestResult.manifest.bounds,
        features,
        counts,
      },
      {
        headers: {
          "cache-control": "public,max-age=5,stale-while-revalidate=15",
          "server-timing":
            `geo-manifest;dur=${manifestMs};desc=\"${manifestResult.source}\", total;dur=${Date.now() - startedAt}`,
          "x-rekixo-project": source.id,
          "x-rekixo-geo-revision": String(revision),
          "x-rekixo-geo-manifest": manifestResult.source,
          "x-content-type-options": "nosniff",
        },
      },
    );
    waitUntil(
      cache.put(cacheKey, response.clone()).catch((error) => {
        console.warn("Public Geo edge cache write skipped", error);
      }),
    );
    return response;
  } catch (error) {
    console.error("Public Geo map load failed", error);
    return Response.json(
      { error: "Satellite Geo map unavailable" },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "server-timing": `total;dur=${Date.now() - startedAt}`,
        },
      },
    );
  }
}
