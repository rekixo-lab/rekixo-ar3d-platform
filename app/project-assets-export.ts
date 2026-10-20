import { env } from "cloudflare:workers";

const encoder = new TextEncoder();
const ZIP32_MAX = 0xffffffff;
const EXPORT_FORMAT_VERSION = 2;

export type ProjectAssetExportOptions = {
  includeLinkedGeoLab?: boolean;
};

export type ProjectAssetManifestFile = {
  path: string;
  label: string;
  section: string;
  source: "generated" | "r2";
  sizeBytes: number;
  contentType: string;
  sourceRef?: string;
  etag?: string;
  sha256?: string;
  uploadedAt?: string;
  customMetadata?: Record<string, string>;
  byteFidelity?: "original-upload" | "system-copy" | "generated";
};

export type ProjectAssetMissing = {
  id: string;
  label: string;
  section: string;
  reason: string;
};

export type ProjectAssetManifest = {
  format: "rekixo-project-export";
  exportFormatVersion: number;
  generatedAt: string;
  packageFileName: string;
  zipMode: "streaming-store";
  project: {
    id: string;
    name: string;
    slug: string;
    kind: string;
    status: string;
    publicStatus: string;
    publishVersion: number;
    publishedAt: string | null;
    publicHost: string | null;
    adminHost: string | null;
    createdAt: string;
    updatedAt: string;
  };
  counts: {
    plots: number;
    measurements: number;
    pricing: number;
    plotAdminDetails: number;
    gallery: number;
    domains: number;
    admins: number;
    memberships: number;
    geoControlPoints: number;
    geoFeatures: number;
    geoSources: number;
    geoVersions: number;
    publishedPlots: number;
    publishedMeasurements: number;
  };
  options: {
    includeLinkedGeoLab: boolean;
  };
  capabilities: {
    linkedGeoLab: { id: string; name: string } | null;
    historicalBinaryVersions: false;
    engineBinaryAssets: false;
  };
  estimatedContentBytes: number;
  files: ProjectAssetManifestFile[];
  missing: ProjectAssetMissing[];
  warnings: string[];
  excludedSensitiveData: string[];
};

type GeneratedEntry = {
  kind: "generated";
  path: string;
  label: string;
  section: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
};

type R2Entry = {
  kind: "r2";
  path: string;
  label: string;
  section: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  etag?: string;
  uploadedAt?: string;
  customMetadata?: Record<string, string>;
  byteFidelity?: "original-upload" | "system-copy";
};

export type ProjectAssetExportEntry = GeneratedEntry | R2Entry;

export type ProjectAssetExportPlan = {
  manifest: ProjectAssetManifest;
  entries: ProjectAssetExportEntry[];
};

type Row = Record<string, unknown>;

const SECTION_LABELS = {
  manifest: "Manifest & recovery notes",
  data: "Project data",
  mapper: "Mapper source files",
  branding: "Branding & media",
  gallery: "Gallery",
  published: "Published snapshot",
  geo: "Geo / GIS",
  integration: "3D integration",
} as const;

function safeSegment(value: string, fallback = "file") {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[^a-zA-Z0-9._() -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 160);
  return cleaned || fallback;
}

function safePackageName(project: { slug: string; id: string }) {
  return `rekixo-${safeSegment(project.slug || project.id, "project")}-project-assets.zip`;
}

function settingMap(rows: Array<{ key: string; value: string }>) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function jsonBytes(value: unknown) {
  return encoder.encode(JSON.stringify(value, null, 2) + "\n");
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  let text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  // CSV is convenience output for spreadsheet use. JSON remains the exact,
  // authoritative representation. Prefix formula-like cells to avoid Excel/Sheets
  // executing project-controlled text as a formula.
  if (/^[=+@-]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvBytes(rows: Row[]) {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines = [
    columns.map(csvValue).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ];
  // BOM keeps UTF-8 Hindi/project names readable in common spreadsheet apps.
  return encoder.encode("\ufeff" + lines.join("\r\n") + "\r\n");
}

function textBytes(value: string) {
  return encoder.encode(value.replace(/\r?\n/g, "\n"));
}

async function sha256(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function contentExtension(contentType: string, fallback = "bin") {
  const type = contentType.toLowerCase().split(";")[0].trim();
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/json": "json",
    "application/geo+json": "geojson",
    "text/csv": "csv",
    "text/plain": "txt",
    "application/zip": "zip",
  };
  return known[type] || fallback;
}

function filenameForStoredObject(
  preferred: string | undefined,
  fallbackBase: string,
  contentType: string,
  fallbackExtension = "bin",
) {
  const preferredSafe = preferred ? safeSegment(preferred) : "";
  const preferredExtension = preferredSafe.includes(".")
    ? preferredSafe.split(".").pop()?.toLowerCase() || ""
    : "";
  const derived = contentExtension(contentType, preferredExtension || fallbackExtension);
  if (preferredSafe && preferredExtension) {
    if (contentType === "application/octet-stream") return preferredSafe;
    return `${preferredSafe.slice(0, -(preferredExtension.length + 1))}.${derived}`;
  }
  return `${safeSegment(preferredSafe || fallbackBase)}.${derived}`;
}

function validR2Key(key: string, allowedPrefixes: string[]) {
  return (
    key.length > 0 &&
    key.length < 1024 &&
    !key.includes("..") &&
    !/[\u0000-\u001f\u007f]/.test(key) &&
    allowedPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

async function all<T extends Row>(sql: string, ...bindings: unknown[]) {
  const result = await env.DB.prepare(sql).bind(...bindings).all<T>();
  return result.results;
}

async function first<T extends Row>(sql: string, ...bindings: unknown[]) {
  return env.DB.prepare(sql).bind(...bindings).first<T>();
}

async function addGenerated(
  entries: ProjectAssetExportEntry[],
  path: string,
  label: string,
  section: string,
  contentType: string,
  bytes: Uint8Array,
) {
  entries.push({
    kind: "generated",
    path,
    label,
    section,
    contentType,
    bytes,
    sha256: await sha256(bytes),
  });
}

async function addJsonAndCsv(
  entries: ProjectAssetExportEntry[],
  basePath: string,
  label: string,
  section: string,
  rows: Row[],
) {
  await addGenerated(
    entries,
    `${basePath}.json`,
    `${label} JSON`,
    section,
    "application/json; charset=utf-8",
    jsonBytes(rows),
  );
  await addGenerated(
    entries,
    `${basePath}.csv`,
    `${label} CSV`,
    section,
    "text/csv; charset=utf-8",
    csvBytes(rows),
  );
}

async function addR2(
  entries: ProjectAssetExportEntry[],
  missing: ProjectAssetMissing[],
  args: {
    id: string;
    objectKey: string;
    path: string;
    label: string;
    section: string;
    allowedPrefixes: string[];
    optional?: boolean;
  },
) {
  if (!validR2Key(args.objectKey, args.allowedPrefixes)) {
    missing.push({
      id: args.id,
      label: args.label,
      section: args.section,
      reason: "Stored object pointer failed export safety validation",
    });
    return null;
  }
  const object = await env.BUCKET.head(args.objectKey);
  if (!object) {
    if (args.optional !== false) {
      missing.push({
        id: args.id,
        label: args.label,
        section: args.section,
        reason: "Not stored for this project",
      });
    }
    return null;
  }
  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  entries.push({
    kind: "r2",
    path: args.path,
    label: args.label,
    section: args.section,
    contentType,
    sizeBytes: Number(object.size || 0),
    objectKey: args.objectKey,
    etag: object.httpEtag || undefined,
    uploadedAt: object.uploaded?.toISOString?.(),
    customMetadata: object.customMetadata,
  });
  return { contentType, sizeBytes: Number(object.size || 0) };
}

function rowsToGeoJson(features: Row[]) {
  return {
    type: "FeatureCollection",
    features: features.map((row) => {
      let geometry: unknown = null;
      let properties: Record<string, unknown> = {};
      try {
        geometry = JSON.parse(String(row.geometry || "null"));
      } catch {
        geometry = null;
      }
      try {
        const parsed = JSON.parse(String(row.properties || "{}"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          properties = parsed as Record<string, unknown>;
        }
      } catch {
        properties = {};
      }
      return {
        type: "Feature",
        id: row.id,
        geometry,
        properties: {
          ...properties,
          name: row.name,
          layer: row.layer,
          linkedPlotId: row.linkedPlotId,
          source: row.source,
          updatedAt: row.updatedAt,
        },
      };
    }),
  };
}

async function loadGeoRows(projectId: string) {
  const [settings, controlPoints, features, sources, versions] = await Promise.all([
    first<Row>(
      "SELECT project_id AS projectId,draft_revision AS draftRevision,published_revision AS publishedRevision,public_enabled AS publicEnabled,published_at AS publishedAt,updated_at AS updatedAt FROM geo_project_settings WHERE project_id=? LIMIT 1",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,id,source_x AS sourceX,source_y AS sourceY,longitude,latitude,label,sort_order AS sortOrder,updated_at AS updatedAt FROM geo_control_points WHERE project_id=? ORDER BY sort_order,id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,id,name,layer,geometry_type AS geometryType,geometry,linked_plot_id AS linkedPlotId,source,properties,updated_at AS updatedAt FROM geo_features WHERE project_id=? ORDER BY layer,name,id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,id,filename,content_type AS contentType,size_bytes AS sizeBytes,sha256,object_key AS objectKey,created_at AS createdAt FROM geo_sources WHERE project_id=? ORDER BY created_at,id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,version,snapshot,created_at AS createdAt FROM geo_versions WHERE project_id=? ORDER BY version",
      projectId,
    ),
  ]);
  return { settings, controlPoints, features, sources, versions };
}

async function addGeoWorkspace(
  entries: ProjectAssetExportEntry[],
  missing: ProjectAssetMissing[],
  project: { id: string; name: string; slug: string },
  basePath: string,
  labelPrefix: string,
) {
  const geo = await loadGeoRows(project.id);
  if (geo.settings) {
    await addGenerated(
      entries,
      `${basePath}/geo-settings.json`,
      `${labelPrefix}Geo settings`,
      "geo",
      "application/json; charset=utf-8",
      jsonBytes(geo.settings),
    );
  }
  if (geo.controlPoints.length) {
    await addJsonAndCsv(
      entries,
      `${basePath}/control-points`,
      `${labelPrefix}Geo control points`,
      "geo",
      geo.controlPoints,
    );
  }
  if (geo.features.length) {
    await addJsonAndCsv(
      entries,
      `${basePath}/features`,
      `${labelPrefix}Geo features`,
      "geo",
      geo.features,
    );
    await addGenerated(
      entries,
      `${basePath}/features.geojson`,
      `${labelPrefix}GeoJSON`,
      "geo",
      "application/geo+json; charset=utf-8",
      jsonBytes(rowsToGeoJson(geo.features)),
    );
  }
  if (geo.versions.length) {
    await addGenerated(
      entries,
      `${basePath}/versions.json`,
      `${labelPrefix}Geo version history`,
      "geo",
      "application/json; charset=utf-8",
      jsonBytes(geo.versions),
    );
  }

  for (const source of geo.sources) {
    const objectKey = String(source.objectKey || "");
    const filename = safeSegment(String(source.filename || source.id || "geo-source"));
    await addR2(entries, missing, {
      id: `geo-source:${String(source.id || "")}`,
      objectKey,
      path: `${basePath}/sources/${safeSegment(String(source.id || "source"))}-${filename}`,
      label: `${labelPrefix}Geo source · ${String(source.filename || source.id || "file")}`,
      section: "geo",
      allowedPrefixes: [`projects/${project.id}/geo/sources/`],
    });
  }

  const overlayKey = `projects/${project.id}/geo/public-overlay.png`;
  await addR2(entries, missing, {
    id: `geo-overlay:${project.id}`,
    objectKey: overlayKey,
    path: `${basePath}/public-overlay.png`,
    label: `${labelPrefix}Geo public overlay`,
    section: "geo",
    allowedPrefixes: [`projects/${project.id}/geo/`],
  });

  return geo;
}

function manifestFile(entry: ProjectAssetExportEntry): ProjectAssetManifestFile {
  return entry.kind === "generated"
    ? {
        path: entry.path,
        label: entry.label,
        section: entry.section,
        source: "generated",
        sizeBytes: entry.bytes.byteLength,
        contentType: entry.contentType,
        sha256: entry.sha256,
        byteFidelity: "generated",
      }
    : {
        path: entry.path,
        label: entry.label,
        section: entry.section,
        source: "r2",
        sizeBytes: entry.sizeBytes,
        contentType: entry.contentType,
        sourceRef: `r2:${entry.objectKey}`,
        etag: entry.etag,
        uploadedAt: entry.uploadedAt,
        customMetadata: entry.customMetadata,
        byteFidelity: entry.byteFidelity || "system-copy",
      };
}

export async function buildProjectAssetExport(
  projectId: string,
  options: ProjectAssetExportOptions = {},
): Promise<ProjectAssetExportPlan | null> {
  const project = await first<{
    id: string;
    name: string;
    slug: string;
    kind: string;
    status: string;
    publicStatus: string;
    publishedAt: string | null;
    publishVersion: number;
    publicHost: string | null;
    adminHost: string | null;
    createdAt: string;
    updatedAt: string;
  }>(
    "SELECT id,name,slug,kind,status,public_status AS publicStatus,published_at AS publishedAt,publish_version AS publishVersion,public_host AS publicHost,admin_host AS adminHost,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE id=? AND status!='deleted' LIMIT 1",
    projectId,
  );
  if (!project) return null;

  const [
    settings,
    domains,
    plots,
    measurements,
    pricing,
    plotAdminDetails,
    gallery,
    admins,
    memberships,
    engineLink,
    publicSnapshot,
    publishedPlots,
    publishedMeasurements,
    publishedSettings,
    geo,
  ] = await Promise.all([
    all<{ key: string; value: string; updatedAt: string }>(
      "SELECT key,value,updated_at AS updatedAt FROM settings WHERE project_id=? ORDER BY key",
      projectId,
    ),
    all<Row>(
      "SELECT host,project_id AS projectId,kind,public_primary AS publicPrimary,admin_primary AS adminPrimary,status,created_at AS createdAt,updated_at AS updatedAt FROM project_domains WHERE project_id=? ORDER BY host",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit AS dimensionUnit,front_edge_index AS frontEdgeIndex,depth_edge_index AS depthEdgeIndex,back_edge_index AS backEdgeIndex,depth2_edge_index AS depth2EdgeIndex,front_label AS frontLabel,depth_label AS depthLabel,back_label AS backLabel,depth2_label AS depth2Label,side_dimensions AS sideDimensions,edge_semantics AS edgeSemantics,polygon,status,notes,featured,inventory_active AS inventoryActive,updated_at AS updatedAt FROM plots WHERE project_id=? ORDER BY id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,plot_id AS plotId,role,segment_index AS segmentIndex,edge_index AS edgeIndex,point_count AS pointCount,length,unit,raw_label AS rawLabel,road_frontage AS roadFrontage,road_access AS roadAccess,source_ref AS sourceRef,source_raw_text AS sourceRawText,confidence,verified,updated_at AS updatedAt FROM plot_edge_measurements WHERE project_id=? ORDER BY plot_id,role,segment_index",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,plot_id AS plotId,pricing_type AS pricingType,unit,rate,fixed_price AS fixedPrice,currency,updated_at AS updatedAt FROM plot_pricing WHERE project_id=? ORDER BY plot_id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,plot_id AS plotId,owner_name AS ownerName,booking_amount_paise AS bookingAmountPaise,currency,broker_name AS brokerName,revision,updated_at AS updatedAt,updated_by AS updatedBy FROM plot_admin_details WHERE project_id=? ORDER BY plot_id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,id,object_key AS objectKey,filename,content_type AS contentType,caption,sort_order AS sortOrder,created_at AS createdAt FROM gallery WHERE project_id=? ORDER BY sort_order DESC,id",
      projectId,
    ),
    all<Row>(
      "SELECT id,email,login_type AS loginType,login_id AS loginId,mobile,name,role,status,must_change_password AS mustChangePassword,password_changed_at AS passwordChangedAt,created_at AS createdAt,updated_at AS updatedAt,last_login_at AS lastLoginAt FROM admin_users WHERE project_id=? ORDER BY created_at,id",
      projectId,
    ),
    all<Row>(
      "SELECT user_id AS userId,project_id AS projectId,role,status,is_primary AS isPrimary,created_at AS createdAt,updated_at AS updatedAt FROM project_memberships WHERE project_id=? ORDER BY created_at,user_id",
      projectId,
    ),
    first<Row>(
      "SELECT platform_project_id AS platformProjectId,engine_project_id AS engineProjectId,engine_slug AS engineSlug,status,public_enabled AS publicEnabled,public_url AS publicUrl,updated_by AS updatedBy,created_at AS createdAt,updated_at AS updatedAt FROM project_3d_links WHERE platform_project_id=? LIMIT 1",
      projectId,
    ),
    first<Row>(
      "SELECT project_id AS projectId,publish_version AS publishVersion,project_name AS projectName,engine_project_id AS engineProjectId,engine_slug AS engineSlug,engine_link_status AS engineLinkStatus,engine_public_enabled AS enginePublicEnabled,engine_public_url AS enginePublicUrl,created_at AS createdAt FROM project_public_snapshots WHERE project_id=? LIMIT 1",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit AS dimensionUnit,front_edge_index AS frontEdgeIndex,depth_edge_index AS depthEdgeIndex,back_edge_index AS backEdgeIndex,depth2_edge_index AS depth2EdgeIndex,front_label AS frontLabel,depth_label AS depthLabel,back_label AS backLabel,depth2_label AS depth2Label,side_dimensions AS sideDimensions,edge_semantics AS edgeSemantics,polygon,status,featured,updated_at AS updatedAt FROM published_plots WHERE project_id=? ORDER BY id",
      projectId,
    ),
    all<Row>(
      "SELECT project_id AS projectId,plot_id AS plotId,role,segment_index AS segmentIndex,edge_index AS edgeIndex,point_count AS pointCount,length,unit,raw_label AS rawLabel,road_frontage AS roadFrontage,road_access AS roadAccess FROM published_plot_edge_measurements WHERE project_id=? ORDER BY plot_id,role,segment_index",
      projectId,
    ),
    all<{ key: string; value: string }>(
      "SELECT key,value FROM published_settings WHERE project_id=? ORDER BY key",
      projectId,
    ),
    loadGeoRows(projectId),
  ]);

  const entries: ProjectAssetExportEntry[] = [];
  const missing: ProjectAssetMissing[] = [];
  const warnings: string[] = [];
  const values = settingMap(settings);

  await addGenerated(
    entries,
    "01-project-data/project.json",
    "Project identity",
    "data",
    "application/json; charset=utf-8",
    jsonBytes(project),
  );
  await addJsonAndCsv(entries, "01-project-data/settings", "Project settings", "data", settings);
  await addJsonAndCsv(entries, "01-project-data/domains", "Project domains", "data", domains);
  await addJsonAndCsv(entries, "01-project-data/plots", "Canonical plots", "data", plots);
  await addJsonAndCsv(
    entries,
    "01-project-data/plot-edge-measurements",
    "Plot edge measurements",
    "data",
    measurements,
  );
  await addJsonAndCsv(entries, "01-project-data/pricing", "Canonical pricing", "data", pricing);
  await addJsonAndCsv(
    entries,
    "01-project-data/private-plot-details",
    "Private plot owner, booking amount and broker details",
    "data",
    plotAdminDetails,
  );

  await addGenerated(
    entries,
    "01-project-data/access/admins-sanitized.json",
    "Client admin metadata (credentials excluded)",
    "data",
    "application/json; charset=utf-8",
    jsonBytes({
      credentialMaterialExcluded: true,
      users: admins,
    }),
  );
  await addGenerated(
    entries,
    "01-project-data/access/memberships.json",
    "Project memberships",
    "data",
    "application/json; charset=utf-8",
    jsonBytes(memberships),
  );

  if (values.pricingSheetName) {
    missing.push({
      id: "pricing-source-original",
      label: `Original pricing upload · ${values.pricingSheetName}`,
      section: "data",
      reason:
        "Current architecture stores canonical pricing in D1, not the original pricing file bytes; pricing.csv/json are generated from authoritative D1 rows",
    });
  }

  const mapperPrefix = `projects/${projectId}/mapper/`;
  const originalToken = String(values.masterplanOriginalObjectToken || "");
  const stableOriginalKey = `${mapperPrefix}masterplanOriginal`;
  let originalKey = stableOriginalKey;
  if (/^[a-zA-Z0-9_-]{12,80}$/.test(originalToken)) {
    const versionedOriginalKey = `${mapperPrefix}masterplanOriginal/${originalToken}`;
    if (await env.BUCKET.head(versionedOriginalKey)) {
      originalKey = versionedOriginalKey;
    } else {
      warnings.push(
        "Versioned masterplan original pointer is missing; export will try the legacy stable original key.",
      );
    }
  }

  const mapperAssets = [
    {
      id: "masterplan-original",
      key: originalKey,
      base: "masterplan-ready-original",
      preferred: values.masterplanOriginalName,
      label: "Masterplan Ready — ORIGINAL / NO COMPRESSION",
      fallbackExt: "bin",
      byteFidelity: "original-upload" as const,
    },
    {
      id: "masterplan-working",
      key: `${mapperPrefix}masterplan`,
      base: "masterplan-working",
      preferred: undefined,
      label: "System working masterplan — optimized copy",
      fallbackExt: "webp",
      byteFidelity: "system-copy" as const,
    },
    {
      id: "masterplan-public",
      key: `${mapperPrefix}masterplanPublic`,
      base: "masterplan-public",
      preferred: undefined,
      label: "Public masterplan — optimized copy",
      fallbackExt: "webp",
      byteFidelity: "system-copy" as const,
    },
    {
      id: "source-pdf",
      key: `${mapperPrefix}sourcePdf`,
      base: "source-pdf-original",
      preferred: values.sourcePdfName || "source-plan.pdf",
      label: "Source PDF — ORIGINAL / NO COMPRESSION",
      fallbackExt: "pdf",
      byteFidelity: "original-upload" as const,
    },
    {
      id: "source-cad",
      key: `${mapperPrefix}sourceCad`,
      base: "source-cad",
      preferred: values.sourceCadName,
      label: "Source CAD",
      fallbackExt: "dwg",
    },
    {
      id: "cad-geometry",
      key: `${mapperPrefix}cadGeometry`,
      base: "cad-geometry",
      preferred: "cad-geometry.json",
      label: "Parsed CAD geometry",
      fallbackExt: "json",
    },
    {
      id: "plot-sheet",
      key: `${mapperPrefix}plotSheet`,
      base: "plot-data-source",
      preferred: values.plotSheetName,
      label: "Plot source sheet",
      fallbackExt: "csv",
    },
    {
      id: "measurement-sheet",
      key: `${mapperPrefix}measurementSheet`,
      base: "measurement-source",
      preferred: values.measurementSheetName,
      label: "Measurement source sheet",
      fallbackExt: "csv",
    },
    {
      id: "road-access-sheet",
      key: `${mapperPrefix}roadAccessSheet`,
      base: "road-access",
      preferred: values.roadAccessSheetName,
      label: "Road Access source",
      fallbackExt: "csv",
    },
    {
      id: "side-mapping-sheet",
      key: `${mapperPrefix}sideMappingSheet`,
      base: "side-mapping",
      preferred: values.sideMappingSheetName,
      label: "Side Mapping source",
      fallbackExt: "csv",
    },
  ];

  for (const asset of mapperAssets) {
    const head = await env.BUCKET.head(asset.key);
    if (!head) {
      missing.push({
        id: asset.id,
        label: asset.label,
        section: "mapper",
        reason: "Not stored for this project",
      });
      continue;
    }
    const contentType = head.httpMetadata?.contentType || "application/octet-stream";
    const preferredName =
      asset.id === "masterplan-original"
        ? String(head.customMetadata?.filename || asset.preferred || "")
        : asset.preferred;
    if (asset.id === "masterplan-original") {
      const expectedSize = Number(head.customMetadata?.expectedSize || 0);
      if (Number.isFinite(expectedSize) && expectedSize > 0 && expectedSize !== Number(head.size || 0)) {
        warnings.push(
          `Masterplan original metadata size ${expectedSize} bytes differs from stored R2 size ${Number(head.size || 0)} bytes.`,
        );
      }
    }
    entries.push({
      kind: "r2",
      path: `02-mapper/${filenameForStoredObject(
        preferredName,
        asset.base,
        contentType,
        asset.fallbackExt,
      )}`,
      label: asset.label,
      section: "mapper",
      contentType,
      sizeBytes: Number(head.size || 0),
      objectKey: asset.key,
      etag: head.httpEtag || undefined,
      uploadedAt: head.uploaded?.toISOString?.(),
      customMetadata: head.customMetadata,
      byteFidelity: asset.byteFidelity || "system-copy",
    });
  }

  const logoHead = await env.BUCKET.head(`${mapperPrefix}logo`);
  if (logoHead) {
    const contentType = logoHead.httpMetadata?.contentType || "application/octet-stream";
    entries.push({
      kind: "r2",
      path: `03-branding/${filenameForStoredObject(
        values.logoName,
        "logo",
        contentType,
        "png",
      )}`,
      label: "Project logo",
      section: "branding",
      contentType,
      sizeBytes: Number(logoHead.size || 0),
      objectKey: `${mapperPrefix}logo`,
      etag: logoHead.httpEtag || undefined,
      uploadedAt: logoHead.uploaded?.toISOString?.(),
      customMetadata: logoHead.customMetadata,
    });
  } else {
    missing.push({
      id: "logo",
      label: "Project logo",
      section: "branding",
      reason: "Not stored for this project",
    });
  }

  for (const share of [
    { id: "share-card", key: `projects/${projectId}/share/card`, base: "share-card", label: "Share card" },
    { id: "share-source", key: `projects/${projectId}/share/source`, base: "share-source", label: "Share original source" },
  ]) {
    const head = await env.BUCKET.head(share.key);
    if (!head) {
      missing.push({
        id: share.id,
        label: share.label,
        section: "branding",
        reason: "Not stored for this project",
      });
      continue;
    }
    const contentType = head.httpMetadata?.contentType || "application/octet-stream";
    entries.push({
      kind: "r2",
      path: `03-branding/${share.base}.${contentExtension(contentType, "bin")}`,
      label: share.label,
      section: "branding",
      contentType,
      sizeBytes: Number(head.size || 0),
      objectKey: share.key,
      etag: head.httpEtag || undefined,
      uploadedAt: head.uploaded?.toISOString?.(),
      customMetadata: head.customMetadata,
    });
  }

  await addGenerated(
    entries,
    "03-branding/share-metadata.json",
    "Share metadata",
    "branding",
    "application/json; charset=utf-8",
    jsonBytes({
      shareTitle: values.shareTitle || "",
      shareDescription: values.shareDescription || "",
      shareImage: values.shareImage || "",
      shareVersion: values.shareVersion || "",
      shareTemplate: values.shareTemplate || "",
    }),
  );

  await addGenerated(
    entries,
    "04-gallery/gallery.json",
    "Gallery metadata",
    "gallery",
    "application/json; charset=utf-8",
    jsonBytes(gallery),
  );
  for (const item of gallery) {
    const objectKey = String(item.objectKey || "");
    const fileName = `${safeSegment(String(item.id || "image")).slice(0, 18)}-${safeSegment(
      String(item.filename || "image"),
    )}`;
    await addR2(entries, missing, {
      id: `gallery:${String(item.id || "")}`,
      objectKey,
      path: `04-gallery/images/${fileName}`,
      label: `Gallery · ${String(item.filename || item.id || "image")}`,
      section: "gallery",
      allowedPrefixes: [`projects/${projectId}/gallery/`],
    });
  }

  const publishedValues = settingMap(publishedSettings);
  if (publicSnapshot) {
    await addGenerated(
      entries,
      "05-published/snapshot.json",
      "Published project snapshot",
      "published",
      "application/json; charset=utf-8",
      jsonBytes(publicSnapshot),
    );
    await addJsonAndCsv(
      entries,
      "05-published/plots",
      "Published plots",
      "published",
      publishedPlots,
    );
    await addJsonAndCsv(
      entries,
      "05-published/plot-edge-measurements",
      "Published measurements",
      "published",
      publishedMeasurements,
    );
    await addJsonAndCsv(
      entries,
      "05-published/settings",
      "Published settings",
      "published",
      publishedSettings,
    );

    const version = Number(publicSnapshot.publishVersion || 0);
    const publishedPrefix = `projects/${projectId}/published/${version}/`;
    for (const publishedAsset of [
      { id: "published-masterplan", kind: "masterplan", label: "Published masterplan", fallback: "webp" },
      { id: "published-masterplan-public", kind: "masterplanPublic", label: "Published public masterplan", fallback: "webp" },
      { id: "published-masterplan-original", kind: "masterplanOriginal", label: "Published original masterplan", fallback: "png" },
      { id: "published-logo", kind: "logo", label: "Published logo", fallback: "png" },
    ]) {
      const key = `${publishedPrefix}${publishedAsset.kind}`;
      const head = await env.BUCKET.head(key);
      if (!head) {
        missing.push({
          id: publishedAsset.id,
          label: publishedAsset.label,
          section: "published",
          reason: "Versioned published binary is not stored for this snapshot",
        });
        continue;
      }
      const contentType = head.httpMetadata?.contentType || "application/octet-stream";
      entries.push({
        kind: "r2",
        path: `05-published/assets/${publishedAsset.kind}.${contentExtension(
          contentType,
          publishedAsset.fallback,
        )}`,
        label: publishedAsset.label,
        section: "published",
        contentType,
        sizeBytes: Number(head.size || 0),
        objectKey: key,
        etag: head.httpEtag || undefined,
        uploadedAt: head.uploaded?.toISOString?.(),
        customMetadata: head.customMetadata,
      });
    }

    const publishedShareVersion = String(publishedValues.shareVersion || "");
    if (/^\d{1,20}$/.test(publishedShareVersion)) {
      const key = `projects/${projectId}/share/cards/${publishedShareVersion}`;
      const head = await env.BUCKET.head(key);
      if (head) {
        const contentType = head.httpMetadata?.contentType || "application/octet-stream";
        entries.push({
          kind: "r2",
          path: `05-published/assets/share-card.${contentExtension(contentType, "webp")}`,
          label: "Published share card",
          section: "published",
          contentType,
          sizeBytes: Number(head.size || 0),
          objectKey: key,
          etag: head.httpEtag || undefined,
          uploadedAt: head.uploaded?.toISOString?.(),
          customMetadata: head.customMetadata,
        });
      } else {
        missing.push({
          id: "published-share-card",
          label: "Published share card",
          section: "published",
          reason: "Published share version is referenced but the versioned R2 object is missing",
        });
      }
    }
  } else {
    missing.push({
      id: "published-snapshot",
      label: "Published snapshot",
      section: "published",
      reason: "Project has no published snapshot yet",
    });
  }

  if (geo.settings) {
    await addGenerated(
      entries,
      "06-geo/geo-settings.json",
      "Geo settings",
      "geo",
      "application/json; charset=utf-8",
      jsonBytes(geo.settings),
    );
  }
  if (geo.controlPoints.length) {
    await addJsonAndCsv(
      entries,
      "06-geo/control-points",
      "Geo control points",
      "geo",
      geo.controlPoints,
    );
  }
  if (geo.features.length) {
    await addJsonAndCsv(entries, "06-geo/features", "Geo features", "geo", geo.features);
    await addGenerated(
      entries,
      "06-geo/features.geojson",
      "GeoJSON",
      "geo",
      "application/geo+json; charset=utf-8",
      jsonBytes(rowsToGeoJson(geo.features)),
    );
  }
  if (geo.versions.length) {
    await addGenerated(
      entries,
      "06-geo/versions.json",
      "Geo version history",
      "geo",
      "application/json; charset=utf-8",
      jsonBytes(geo.versions),
    );
  }
  for (const source of geo.sources) {
    await addR2(entries, missing, {
      id: `geo-source:${String(source.id || "")}`,
      objectKey: String(source.objectKey || ""),
      path: `06-geo/sources/${safeSegment(String(source.id || "source")).slice(0, 18)}-${safeSegment(
        String(source.filename || "source"),
      )}`,
      label: `Geo source · ${String(source.filename || source.id || "file")}`,
      section: "geo",
      allowedPrefixes: [`projects/${projectId}/geo/sources/`],
    });
  }

  const linkedGeoLabId = String(values.geoPublicLabProjectId || "");
  const linkedGeoLab =
    linkedGeoLabId && linkedGeoLabId !== projectId
      ? await first<{ id: string; name: string; slug: string; kind: string }>(
          "SELECT id,name,slug,kind FROM projects WHERE id=? AND kind='geo_lab' AND status!='deleted' LIMIT 1",
          linkedGeoLabId,
        )
      : null;

  const allowedGeoPrefixes = [
    `projects/${projectId}/geo/`,
    ...(linkedGeoLab ? [`projects/${linkedGeoLab.id}/geo/`] : []),
  ];
  for (const [keyName, fallback] of [
    ["geoPublicOverlayKey", "overlay"],
    ["geoPublicManifestKey", "manifest"],
    ["geoPublicOverlayMobileKey", "overlay-mobile"],
    ["geoPublicOverlayDesktopKey", "overlay-desktop"],
  ] as const) {
    const key = String(values[keyName] || "");
    if (!key) continue;
    if (!validR2Key(key, allowedGeoPrefixes)) {
      missing.push({
        id: `geo-live:${keyName}`,
        label: `Geo live · ${fallback}`,
        section: "geo",
        reason: "Geo live pointer is outside the selected/linked project safety boundary",
      });
      continue;
    }
    const head = await env.BUCKET.head(key);
    if (!head) {
      missing.push({
        id: `geo-live:${keyName}`,
        label: `Geo live · ${fallback}`,
        section: "geo",
        reason: "Configured Geo live object is missing",
      });
      continue;
    }
    const contentType = head.httpMetadata?.contentType || "application/octet-stream";
    entries.push({
      kind: "r2",
      path: `06-geo/live/${fallback}.${contentExtension(
        contentType,
        fallback === "manifest" ? "json" : "png",
      )}`,
      label: `Geo live · ${fallback}`,
      section: "geo",
      contentType,
      sizeBytes: Number(head.size || 0),
      objectKey: key,
      etag: head.httpEtag || undefined,
      uploadedAt: head.uploaded?.toISOString?.(),
      customMetadata: head.customMetadata,
    });
  }

  if (project.kind === "geo_lab") {
    const overlayKey = `projects/${projectId}/geo/public-overlay.png`;
    if (!entries.some((entry) => entry.kind === "r2" && entry.objectKey === overlayKey)) {
      await addR2(entries, missing, {
        id: "geo-lab-public-overlay",
        objectKey: overlayKey,
        path: "06-geo/live/public-overlay.png",
        label: "Geo Lab public overlay",
        section: "geo",
        allowedPrefixes: [`projects/${projectId}/geo/`],
      });
    }
  }

  if (options.includeLinkedGeoLab && linkedGeoLab) {
    const linkedBase = `06-geo/linked-lab-${safeSegment(linkedGeoLab.slug || linkedGeoLab.id)}`;
    await addGenerated(
      entries,
      `${linkedBase}/project.json`,
      "Linked Geo Lab identity",
      "geo",
      "application/json; charset=utf-8",
      jsonBytes(linkedGeoLab),
    );
    await addGeoWorkspace(
      entries,
      missing,
      linkedGeoLab,
      linkedBase,
      "Linked Geo Lab · ",
    );
  }

  await addGenerated(
    entries,
    "07-integration/3d-engine-link.json",
    "3D Engine link metadata",
    "integration",
    "application/json; charset=utf-8",
    jsonBytes({
      note:
        "Platform export includes only link metadata. AR3D Engine scenes/models/textures stay isolated in the Engine system.",
      link: engineLink,
    }),
  );

  const readme = `REKIXO PROJECT ASSET EXPORT
===========================

Export format version: ${EXPORT_FORMAT_VERSION}
Project: ${project.name}
Project ID: ${project.id}

Purpose
-------
This ZIP is a read-only recovery/export package for one explicit Rekixo project.
It contains the current editable project state, current published snapshot (when
available), mapper source assets, branding/gallery, Geo data and Platform-to-3D
link metadata.

Original-file fidelity
----------------------
"Masterplan Ready — ORIGINAL / NO COMPRESSION" and "Source PDF — ORIGINAL / NO
COMPRESSION" are streamed from the exact R2 objects saved at upload time. The ZIP
writer uses STORE mode (no deflate/re-encoding), so these files keep their original
stored bytes and R2 byte size. Separate working/public masterplan copies are clearly
labeled optimized system copies.

Authoritative data
------------------
JSON files preserve exact database values. CSV files are convenience copies for
spreadsheet use and formula-like text cells are escaped for spreadsheet safety.
Private plot details are included in private-plot-details.json/csv. Booking
amounts are stored as exact integer paise (INR); null means no amount recorded,
and zero means an explicitly recorded zero amount. These files are private admin
data and must not be copied into public project snapshots or customer assets.

Security exclusions
-------------------
Password hashes, password salts, session versions/cookies, login-attempt buckets,
Super Admin credentials, Cloudflare/API secrets and platform-wide secrets are
intentionally excluded. Client admin identity metadata is exported without
credential material.

Architecture boundaries
-----------------------
AR3D Engine binary scenes/models/textures are NOT copied into this Platform ZIP.
Only the project_3d_links metadata is included. Linked Geo Lab workspace data is
included only when the explicit "Include linked Geo Lab workspace" option is used.

Binary history
--------------
The package captures the current canonical source assets and current published
snapshot/version. Historical R2 binary generations are intentionally not swept by
prefix, preventing orphaned/deleted/unrelated objects from entering a backup.

Restore note
------------
Do not restore by blindly copying every file into R2. Use manifest.json and the
canonical D1 JSON datasets, preserving project isolation and current schema rules.
`;
  await addGenerated(
    entries,
    "00-manifest/README.txt",
    "Recovery README",
    "manifest",
    "text/plain; charset=utf-8",
    textBytes(readme),
  );

  if (publicSnapshot && Number(publicSnapshot.publishVersion) !== Number(project.publishVersion)) {
    warnings.push(
      `Published snapshot version ${String(publicSnapshot.publishVersion)} differs from project publishVersion ${String(project.publishVersion)}.`,
    );
  }
  if (linkedGeoLab && !options.includeLinkedGeoLab) {
    warnings.push(
      `Linked Geo Lab ${linkedGeoLab.name} is referenced but its full working workspace is not included unless the advanced option is enabled.`,
    );
  }

  const files = entries.map(manifestFile);
  const estimatedContentBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const manifest: ProjectAssetManifest = {
    format: "rekixo-project-export",
    exportFormatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    packageFileName: safePackageName(project),
    zipMode: "streaming-store",
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      kind: project.kind,
      status: project.status,
      publicStatus: project.publicStatus,
      publishVersion: Number(project.publishVersion || 0),
      publishedAt: project.publishedAt,
      publicHost: project.publicHost,
      adminHost: project.adminHost,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    counts: {
      plots: plots.length,
      measurements: measurements.length,
      pricing: pricing.length,
      plotAdminDetails: plotAdminDetails.length,
      gallery: gallery.length,
      domains: domains.length,
      admins: admins.length,
      memberships: memberships.length,
      geoControlPoints: geo.controlPoints.length,
      geoFeatures: geo.features.length,
      geoSources: geo.sources.length,
      geoVersions: geo.versions.length,
      publishedPlots: publishedPlots.length,
      publishedMeasurements: publishedMeasurements.length,
    },
    options: {
      includeLinkedGeoLab: Boolean(options.includeLinkedGeoLab && linkedGeoLab),
    },
    capabilities: {
      linkedGeoLab: linkedGeoLab
        ? { id: linkedGeoLab.id, name: linkedGeoLab.name }
        : null,
      historicalBinaryVersions: false,
      engineBinaryAssets: false,
    },
    estimatedContentBytes,
    files,
    missing,
    warnings,
    excludedSensitiveData: [
      "admin_users.password_hash",
      "admin_users.password_salt",
      "admin_users.session_version",
      "login_attempts",
      "session cookies/tokens",
      "Super Admin credentials",
      "Cloudflare/API/environment secrets",
      "platform_settings",
      "platform-wide audit logs",
      "AR3D Engine binary models/scenes/textures",
    ],
  };

  const manifestBytes = jsonBytes(manifest);
  entries.unshift({
    kind: "generated",
    path: "00-manifest/manifest.json",
    label: "Export manifest",
    section: "manifest",
    contentType: "application/json; charset=utf-8",
    bytes: manifestBytes,
    sha256: await sha256(manifestBytes),
  });

  return { manifest, entries };
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function joinBytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crcUpdate(crc: number, chunk: Uint8Array) {
  let value = crc >>> 0;
  for (const byte of chunk) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const dosTime =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { dosDate, dosTime };
}

type CentralRecord = {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  dosDate: number;
  dosTime: number;
};

function localHeader(name: Uint8Array, dosDate: number, dosTime: number) {
  return joinBytes(
    u32(0x04034b50),
    u16(20),
    u16(0x0808),
    u16(0),
    u16(dosTime),
    u16(dosDate),
    u32(0),
    u32(0),
    u32(0),
    u16(name.byteLength),
    u16(0),
    name,
  );
}

function dataDescriptor(crc: number, size: number) {
  return joinBytes(u32(0x08074b50), u32(crc), u32(size), u32(size));
}

function centralHeader(record: CentralRecord) {
  return joinBytes(
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0808),
    u16(0),
    u16(record.dosTime),
    u16(record.dosDate),
    u32(record.crc),
    u32(record.size),
    u32(record.size),
    u16(record.name.byteLength),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(record.offset),
    record.name,
  );
}

function endOfCentralDirectory(count: number, size: number, offset: number) {
  return joinBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(size),
    u32(offset),
    u16(0),
  );
}

async function* zipChunks(plan: ProjectAssetExportPlan) {
  if (plan.entries.length > 65535)
    throw new Error("Project export has too many ZIP entries");
  if (plan.manifest.estimatedContentBytes > ZIP32_MAX - 32 * 1024 * 1024)
    throw new Error("Project export is too large for the current streaming ZIP format");

  let offset = 0;
  const central: CentralRecord[] = [];
  const stamp = dosDateTime(new Date(plan.manifest.generatedAt));

  for (const entry of plan.entries) {
    const name = encoder.encode(entry.path);
    if (!name.byteLength || name.byteLength > 65535)
      throw new Error("Project export contains an invalid ZIP path");

    const localOffset = offset;
    const header = localHeader(name, stamp.dosDate, stamp.dosTime);
    yield header;
    offset += header.byteLength;

    let crc = 0xffffffff;
    let size = 0;

    if (entry.kind === "generated") {
      crc = crcUpdate(crc, entry.bytes);
      size = entry.bytes.byteLength;
      yield entry.bytes;
      offset += entry.bytes.byteLength;
    } else {
      const object = await env.BUCKET.get(entry.objectKey);
      if (!object) throw new Error(`Export asset disappeared during download: ${entry.label}`);
      const reader = object.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          const chunk = next.value;
          crc = crcUpdate(crc, chunk);
          size += chunk.byteLength;
          if (size > ZIP32_MAX) throw new Error(`ZIP entry too large: ${entry.label}`);
          yield chunk;
          offset += chunk.byteLength;
        }
      } finally {
        reader.releaseLock();
      }
      if (size !== entry.sizeBytes)
        throw new Error(`Export asset size changed during download: ${entry.label}`);
    }

    const finalCrc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = dataDescriptor(finalCrc, size);
    yield descriptor;
    offset += descriptor.byteLength;
    central.push({
      name,
      crc: finalCrc,
      size,
      offset: localOffset,
      dosDate: stamp.dosDate,
      dosTime: stamp.dosTime,
    });
    if (offset > ZIP32_MAX) throw new Error("Project export exceeded ZIP32 streaming limit");
  }

  const centralOffset = offset;
  for (const record of central) {
    const header = centralHeader(record);
    yield header;
    offset += header.byteLength;
  }
  const centralSize = offset - centralOffset;
  if (offset > ZIP32_MAX || centralSize > ZIP32_MAX)
    throw new Error("Project export central directory exceeded ZIP32 limit");
  yield endOfCentralDirectory(central.length, centralSize, centralOffset);
}

export function projectAssetZipStream(plan: ProjectAssetExportPlan) {
  const iterator = zipChunks(plan)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export { SECTION_LABELS };
