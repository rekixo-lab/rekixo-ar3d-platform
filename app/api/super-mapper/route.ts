import { env } from "cloudflare:workers";
import { requireSuperAdmin, sameOrigin } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { parseCadGeometry } from "@/modules/mapper";
import { cleanPlotId, type HomographyPair } from "@/modules/mapper";
import { type EdgeDirection } from "@/modules/plots";
import { assessPlotSheetRows, parsePlotSheetText } from "@/modules/plots";
import { normalizeSqmToSqftFactor } from "@/modules/plots";
import { parsePlotMeasurementSheetText } from "@/modules/mapper";
import { resolveFourSideEdges } from "@/modules/plots";
import { parseRoadAccessSheetText } from "@/modules/mapper";
import { parseSideMappingSheetText } from "@/modules/mapper";
import {
  parsePlotSideSemantics,
  serializePlotSideSemantics,
  type PlotSideRole,
} from "@/modules/plots";
import {
  freezeCurrentPublishedAssets,
} from "@/modules/public-publish-snapshot";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function imageUploadLooksValid(file: File) {
  const type = String(file.type || "").toLowerCase();
  if (IMAGE_MIME_TYPES.has(type)) return true;
  const extension = file.name.toLowerCase().split(".").pop() || "";
  return (
    IMAGE_EXTENSIONS.has(extension) &&
    (!type || type === "image/jpg" || type === "application/octet-stream")
  );
}

const denied = () =>
  Response.json({ error: "Super Admin access required" }, { status: 403 });
const COMPLETED_PROJECT_ID = "tiyansh-prime-square";
const SETTINGS_WHITELIST = new Set([
  "mapWidth",
  "mapHeight",
  "masterplanOriginalWidth",
  "masterplanOriginalHeight",
  "cadBounds",
  "homography",
  "calibrationPairs",
  "calibrationError",
  "cadMatchedCount",
  "cadReviewCount",
  "publicRotation",
  "masterplanNorthAngle",
  "address",
  "sqmToSqftFactor",
]);

async function projectExists(projectId: string) {
  return Boolean(
    await env.DB.prepare(
      "SELECT id FROM projects WHERE id=? AND status!='deleted' LIMIT 1",
    )
      .bind(projectId)
      .first(),
  );
}

type PlotInventoryDiff = {
  existingActiveCount: number;
  incomingCount: number;
  retainedCount: number;
  addedIds: string[];
  restoredIds: string[];
  missingIds: string[];
  missingMappedIds: string[];
  missingNonAvailableIds: string[];
  missingPricedIds: string[];
  missingAdminDetailsIds: string[];
  confirmationRequired: boolean;
  confirmationToken: string;
};

async function inventoryConfirmationToken(
  projectId: string,
  incomingIds: string[],
  existingRows: Array<{ id: string; inventoryActive: number | boolean }>,
) {
  const state = JSON.stringify({
    projectId,
    incoming: [...incomingIds].sort(),
    active: existingRows
      .filter((row) => Boolean(row.inventoryActive))
      .map((row) => row.id)
      .sort(),
    inactive: existingRows
      .filter((row) => !Boolean(row.inventoryActive))
      .map((row) => row.id)
      .sort(),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function plotInventoryDiff(
  projectId: string,
  incomingIds: string[],
): Promise<PlotInventoryDiff> {
  const result = await env.DB.prepare(
    `SELECT
       p.id,
       p.inventory_active AS inventoryActive,
       p.status,
       p.polygon,
       CASE WHEN EXISTS (
         SELECT 1 FROM plot_pricing pr
         WHERE pr.project_id=p.project_id AND pr.plot_id=p.id
       ) THEN 1 ELSE 0 END AS priced,
       CASE WHEN EXISTS (
         SELECT 1 FROM plot_admin_details ad
         WHERE ad.project_id=p.project_id AND ad.plot_id=p.id
           AND (COALESCE(TRIM(ad.owner_name),'')<>''
             OR ad.booking_amount_paise IS NOT NULL
             OR COALESCE(TRIM(ad.broker_name),'')<>'')
       ) THEN 1 ELSE 0 END AS hasAdminDetails
     FROM plots p
     WHERE p.project_id=?
     ORDER BY p.id`,
  )
    .bind(projectId)
    .all<{
      id: string;
      inventoryActive: number | boolean;
      status: string;
      polygon: string | null;
      priced: number;
      hasAdminDetails: number;
    }>();

  const rows = result.results;
  const incoming = new Set(incomingIds);
  const allById = new Map(rows.map((row) => [row.id, row]));
  const activeRows = rows.filter((row) => Boolean(row.inventoryActive));
  const missingRows = activeRows.filter((row) => !incoming.has(row.id));
  const addedIds = incomingIds.filter((id) => !allById.has(id));
  const restoredIds = incomingIds.filter((id) => {
    const row = allById.get(id);
    return Boolean(row && !Boolean(row.inventoryActive));
  });
  const retainedCount = incomingIds.length - addedIds.length - restoredIds.length;
  const confirmationToken = missingRows.length
    ? await inventoryConfirmationToken(projectId, incomingIds, rows)
    : "";

  return {
    existingActiveCount: activeRows.length,
    incomingCount: incomingIds.length,
    retainedCount,
    addedIds,
    restoredIds,
    missingIds: missingRows.map((row) => row.id),
    missingMappedIds: missingRows
      .filter((row) => String(row.polygon || "").trim())
      .map((row) => row.id),
    missingNonAvailableIds: missingRows
      .filter((row) => row.status !== "available")
      .map((row) => row.id),
    missingPricedIds: missingRows
      .filter((row) => Boolean(row.priced))
      .map((row) => row.id),
    missingAdminDetailsIds: missingRows
      .filter((row) => Boolean(row.hasAdminDetails))
      .map((row) => row.id),
    confirmationRequired: missingRows.length > 0,
    confirmationToken,
  };
}

async function setPlotInventoryActive(
  projectId: string,
  ids: string[],
  active: boolean,
  now: string,
) {
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE plots
       SET inventory_active=?,updated_at=?
       WHERE project_id=? AND id IN (${placeholders})`,
    )
      .bind(active ? 1 : 0, now, projectId, ...chunk)
      .run();
  }
}

function validPolygon(value: string) {
  try {
    const points = JSON.parse(value);
    return (
      Array.isArray(points) &&
      points.length >= 3 &&
      points.length <= 80 &&
      points.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((v) => typeof v === "number" && v >= 0 && v <= 1),
      )
    );
  } catch {
    return false;
  }
}

function optionalPositiveMeasure(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function cleanDimensionText(value: unknown, maxLength: number) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return text || null;
}

function cleanPlot(projectId: string, p: Record<string, unknown>, now: string) {
  const id = cleanPlotId(String(p.id || "")),
    polygon = String(p.polygon || ""),
    status = String(p.status || "available"),
    numbers = [Number(p.sqft), Number(p.sqm), Number(p.sqyd)],
    front = optionalPositiveMeasure(p.front),
    depth = optionalPositiveMeasure(p.depth),
    back = optionalPositiveMeasure(p.back),
    depth2 = optionalPositiveMeasure(p.depth2),
    edgeRaw = p.frontEdgeIndex ?? p.front_edge_index,
    depthEdgeRaw = p.depthEdgeIndex ?? p.depth_edge_index,
    backEdgeRaw = p.backEdgeIndex ?? p.back_edge_index,
    depth2EdgeRaw = p.depth2EdgeIndex ?? p.depth2_edge_index,
    frontEdgeIndex =
      edgeRaw === null || edgeRaw === undefined || String(edgeRaw).trim() === ""
        ? null
        : Number(edgeRaw),
    depthEdgeIndex =
      depthEdgeRaw === null || depthEdgeRaw === undefined || String(depthEdgeRaw).trim() === ""
        ? null
        : Number(depthEdgeRaw),
    backEdgeIndex =
      backEdgeRaw === null || backEdgeRaw === undefined || String(backEdgeRaw).trim() === ""
        ? null
        : Number(backEdgeRaw),
    depth2EdgeIndex =
      depth2EdgeRaw === null || depth2EdgeRaw === undefined || String(depth2EdgeRaw).trim() === ""
        ? null
        : Number(depth2EdgeRaw);
  const rawUnit = String(p.dimensionUnit ?? p.dimension_unit ?? "").trim().toLowerCase();
  const dimensionUnit =
    front !== null || depth !== null || back !== null || depth2 !== null
      ? rawUnit === "m"
        ? "m"
        : rawUnit === "ft" || rawUnit === ""
          ? "ft"
          : ""
      : rawUnit === "m" || rawUnit === "ft"
        ? rawUnit
        : null;
  const frontLabel = cleanDimensionText(p.frontLabel ?? p.front_label, 160);
  const depthLabel = cleanDimensionText(p.depthLabel ?? p.depth_label, 160);
  const backLabel = cleanDimensionText(p.backLabel ?? p.back_label, 160);
  const depth2Label = cleanDimensionText(p.depth2Label ?? p.depth2_label, 160);
  const sideDimensions = cleanDimensionText(
    p.sideDimensions ?? p.side_dimensions,
    500,
  );
  const polygonPointCount = polygon
    ? (() => {
        try {
          const parsed = JSON.parse(polygon);
          return Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          return 0;
        }
      })()
    : 0;
  let edgeSemantics: string | null = null;
  const suppliedSemantics = p.edgeSemantics ?? p.edge_semantics;
  if (suppliedSemantics != null && String(suppliedSemantics).trim()) {
    const parsed = parsePlotSideSemantics(
      suppliedSemantics,
      polygonPointCount >= 3 ? polygonPointCount : undefined,
    );
    if (!parsed) return null;
    // parsePlotSideSemantics preserves optional three/four logical-side layout.
    // Existing v1 rows without layout stay byte-compatible after read/write.
    edgeSemantics = JSON.stringify(parsed);
  } else if (
    polygonPointCount >= 3 &&
    (frontEdgeIndex !== null ||
      backEdgeIndex !== null ||
      depthEdgeIndex !== null ||
      depth2EdgeIndex !== null)
  ) {
    edgeSemantics = serializePlotSideSemantics(polygonPointCount, {
      ...(frontEdgeIndex !== null ? { front: [frontEdgeIndex] } : {}),
      ...(backEdgeIndex !== null ? { back: [backEdgeIndex] } : {}),
      ...(depthEdgeIndex !== null ? { depthA: [depthEdgeIndex] } : {}),
      ...(depth2EdgeIndex !== null ? { depthB: [depth2EdgeIndex] } : {}),
    });
  }
  if (
    !id ||
    (polygon && !validPolygon(polygon)) ||
    !["available", "booked", "sold"].includes(status) ||
    numbers.some((value) => !Number.isFinite(value) || value < 0) ||
    Number.isNaN(front) ||
    Number.isNaN(depth) ||
    Number.isNaN(back) ||
    Number.isNaN(depth2) ||
    dimensionUnit === "" ||
    (frontEdgeIndex !== null &&
      (!Number.isInteger(frontEdgeIndex) || frontEdgeIndex < 0 || frontEdgeIndex > 79)) ||
    (depthEdgeIndex !== null &&
      (!Number.isInteger(depthEdgeIndex) || depthEdgeIndex < 0 || depthEdgeIndex > 79)) ||
    (backEdgeIndex !== null &&
      (!Number.isInteger(backEdgeIndex) || backEdgeIndex < 0 || backEdgeIndex > 79)) ||
    (depth2EdgeIndex !== null &&
      (!Number.isInteger(depth2EdgeIndex) || depth2EdgeIndex < 0 || depth2EdgeIndex > 79))
  )
    return null;

  if (polygon && (frontEdgeIndex !== null || depthEdgeIndex !== null)) {
    try {
      const polygonPoints = JSON.parse(polygon) as unknown[];
      if (frontEdgeIndex !== null && frontEdgeIndex >= polygonPoints.length) return null;
      if (depthEdgeIndex !== null && depthEdgeIndex >= polygonPoints.length) return null;
      if (backEdgeIndex !== null && backEdgeIndex >= polygonPoints.length) return null;
      if (depth2EdgeIndex !== null && depth2EdgeIndex >= polygonPoints.length) return null;
    } catch {
      return null;
    }
  }

  return {
    projectId,
    id,
    sqft: numbers[0],
    sqm: numbers[1],
    sqyd: numbers[2],
    dimensions: String(p.dimensions || "").slice(0, 120),
    road: String(p.road || "").slice(0, 160),
    front,
    depth,
    back,
    depth2,
    dimensionUnit,
    // A plot without a persisted boundary must never retain geometry-derived
    // edge assignments. Measurement values/labels stay intact and can be
    // rebound after the next boundary is confirmed.
    frontEdgeIndex: polygonPointCount >= 3 ? frontEdgeIndex : null,
    depthEdgeIndex: polygonPointCount >= 3 ? depthEdgeIndex : null,
    backEdgeIndex: polygonPointCount >= 3 ? backEdgeIndex : null,
    depth2EdgeIndex: polygonPointCount >= 3 ? depth2EdgeIndex : null,
    frontLabel,
    depthLabel,
    backLabel,
    depth2Label,
    sideDimensions,
    edgeSemantics: polygonPointCount >= 3 ? edgeSemantics : null,
    polygon,
    status,
    notes: String(p.notes || "").slice(0, 2000),
    featured: p.featured ? 1 : 0,
    updatedAt: now,
  };
}

async function writeSetting(projectId: string, key: string, value: string, now: string) {
  await env.DB.prepare(
    "INSERT INTO settings (project_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  )
    .bind(projectId, key, value, now)
    .run();
}

async function deleteSettings(projectId: string, keys: string[]) {
  if (!keys.length) return;
  await env.DB.batch(
    keys.map((key) =>
      env.DB.prepare("DELETE FROM settings WHERE project_id=? AND key=?").bind(projectId, key),
    ),
  );
}

async function projectSqmToSqftFactor(projectId: string) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE project_id=? AND key='sqmToSqftFactor' LIMIT 1",
  )
    .bind(projectId)
    .first<{ value: string }>();
  return normalizeSqmToSqftFactor(row?.value);
}

type EdgeBinding = {
  id: string;
  pointCount: number;
  front: number;
  back: number;
  depthA: number;
  depthB: number | null;
  roadFacingRoles?: PlotSideRole[];
};

async function syncMeasurementBindings(
  projectId: string,
  bindings: EdgeBinding[],
  now: string,
) {
  if (!bindings.length) return;
  const statements = bindings.flatMap((binding) => {
    const roadFacing = new Set<PlotSideRole>(
      binding.roadFacingRoles?.length ? binding.roadFacingRoles : ["front"],
    );
    return ([
      ["front", binding.front],
      ["back", binding.back],
      ["depthA", binding.depthA],
      ["depthB", binding.depthB],
    ] as const).map(([role, edge]) =>
      env.DB.prepare(
        "UPDATE plot_edge_measurements SET edge_index=?,point_count=?,road_frontage=?,updated_at=? WHERE project_id=? AND plot_id=? AND role=?",
      ).bind(
        edge,
        binding.pointCount,
        roadFacing.has(role) ? 1 : 0,
        now,
        projectId,
        binding.id,
        role,
      ),
    );
  });
  for (let index = 0; index < statements.length; index += 80) {
    await env.DB.batch(statements.slice(index, index + 80));
  }
}

function validCalibrationPair(value: unknown): value is HomographyPair {
  if (!value || typeof value !== "object") return false;
  const pair = value as HomographyPair;
  const validPoint = (point: unknown) =>
    Array.isArray(point) &&
    point.length === 2 &&
    point.every((item) => Number.isFinite(item) && Number(item) >= 0 && Number(item) <= 1);
  return validPoint(pair.source) && validPoint(pair.target);
}

function validatedSetting(key: string, raw: unknown) {
  if (["mapWidth", "mapHeight", "masterplanOriginalWidth", "masterplanOriginalHeight"].includes(key)) {
    const number = Number(raw);
    if (!(number >= 100 && number <= 10000)) throw new Error(`${key} invalid hai`);
    return String(Math.round(number));
  }
  if (key === "address") {
    if (typeof raw !== "string") throw new Error("Website header address invalid hai");
    const value = raw.trim().replace(/\s+/g, " ");
    if (value.length > 180) throw new Error("Website header address bahut lamba hai");
    return value;
  }
  if (key === "publicRotation") {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > 3)
      throw new Error("publicRotation invalid hai");
    return String(number);
  }
  if (key === "masterplanNorthAngle") {
    // An empty string opts out and restores the legacy North setting.
    if (typeof raw === "string" && raw.trim() === "") return "";
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number >= 360)
      throw new Error("masterplanNorthAngle 0 se 360 ke beech hona chahiye");
    return String(Number(number.toFixed(3)));
  }
  if (key === "sqmToSqftFactor") {
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 9 || number > 12)
      throw new Error("Sq.M to Sq.Ft factor 9 aur 12 ke beech hona chahiye");
    return String(Number(number.toFixed(6)));
  }
  if (["cadMatchedCount", "cadReviewCount"].includes(key)) {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > 5000) throw new Error(`${key} invalid hai`);
    return String(number);
  }
  if (key === "calibrationError") {
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > 10) throw new Error("Calibration error invalid hai");
    return String(number);
  }
  if (key === "homography") {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || parsed.length !== 9 || !parsed.every(Number.isFinite))
      throw new Error("Homography matrix invalid hai");
    return JSON.stringify(parsed);
  }
  if (key === "calibrationPairs") {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || parsed.length < 4 || parsed.length > 12 || !parsed.every(validCalibrationPair))
      throw new Error("Calibration pairs invalid hain");
    return JSON.stringify(parsed);
  }
  if (key === "cadBounds") {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const bounds = parsed as Record<string, unknown> | null;
    if (
      !bounds ||
      !["minX", "minY", "maxX", "maxY"].every((name) => Number.isFinite(Number(bounds[name])))
    )
      throw new Error("CAD bounds invalid hain");
    return JSON.stringify(parsed);
  }
  const value = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (value.length > 12000) throw new Error(`${key} setting bahut badi hai`);
  return value;
}

async function savePlots(
  projectId: string,
  incoming: Record<string, unknown>[],
  preserveGeometry = false,
) {
  const now = new Date().toISOString();
  const cleaned = incoming.map((plot) => cleanPlot(projectId, plot, now));
  if (cleaned.some((plot) => !plot)) throw new Error("Plot data सही नहीं है");
  const saved = cleaned.filter((plot): plot is NonNullable<typeof plot> => Boolean(plot));
  // Plot-sheet re-import preserves hand-curated geometry/status and only replaces
  // semantic Front/Depth metadata when the incoming sheet explicitly supplies it.
  const statement = preserveGeometry
    ? "INSERT INTO plots (project_id,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit,front_edge_index,depth_edge_index,back_edge_index,depth2_edge_index,front_label,depth_label,back_label,depth2_label,side_dimensions,edge_semantics,polygon,status,notes,featured,inventory_active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET sqft=excluded.sqft,sqm=excluded.sqm,sqyd=excluded.sqyd,dimensions=excluded.dimensions,road=excluded.road,front=COALESCE(excluded.front,front),depth=COALESCE(excluded.depth,depth),back=COALESCE(excluded.back,back),depth2=COALESCE(excluded.depth2,depth2),dimension_unit=COALESCE(excluded.dimension_unit,dimension_unit),front_edge_index=COALESCE(excluded.front_edge_index,front_edge_index),depth_edge_index=COALESCE(excluded.depth_edge_index,depth_edge_index),back_edge_index=COALESCE(excluded.back_edge_index,back_edge_index),depth2_edge_index=COALESCE(excluded.depth2_edge_index,depth2_edge_index),front_label=COALESCE(excluded.front_label,front_label),depth_label=COALESCE(excluded.depth_label,depth_label),back_label=COALESCE(excluded.back_label,back_label),depth2_label=COALESCE(excluded.depth2_label,depth2_label),side_dimensions=COALESCE(excluded.side_dimensions,side_dimensions),edge_semantics=COALESCE(excluded.edge_semantics,edge_semantics),inventory_active=1,notes=excluded.notes,updated_at=excluded.updated_at"
    : "INSERT INTO plots (project_id,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit,front_edge_index,depth_edge_index,back_edge_index,depth2_edge_index,front_label,depth_label,back_label,depth2_label,side_dimensions,edge_semantics,polygon,status,notes,featured,inventory_active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET sqft=excluded.sqft,sqm=excluded.sqm,sqyd=excluded.sqyd,dimensions=excluded.dimensions,road=excluded.road,front=excluded.front,depth=excluded.depth,back=excluded.back,depth2=excluded.depth2,dimension_unit=excluded.dimension_unit,front_edge_index=excluded.front_edge_index,depth_edge_index=excluded.depth_edge_index,back_edge_index=excluded.back_edge_index,depth2_edge_index=excluded.depth2_edge_index,front_label=excluded.front_label,depth_label=excluded.depth_label,back_label=excluded.back_label,depth2_label=excluded.depth2_label,side_dimensions=excluded.side_dimensions,edge_semantics=excluded.edge_semantics,polygon=excluded.polygon,inventory_active=1,notes=excluded.notes,updated_at=excluded.updated_at";

  for (let index = 0; index < saved.length; index += 80) {
    const chunk = saved.slice(index, index + 80);
    await env.DB.batch(
      chunk.map((plot) =>
        env.DB.prepare(statement).bind(
          plot.projectId,
          plot.id,
          plot.sqft,
          plot.sqm,
          plot.sqyd,
          plot.dimensions,
          plot.road,
          plot.front,
          plot.depth,
          plot.back,
          plot.depth2,
          plot.dimensionUnit,
          plot.frontEdgeIndex,
          plot.depthEdgeIndex,
          plot.backEdgeIndex,
          plot.depth2EdgeIndex,
          plot.frontLabel,
          plot.depthLabel,
          plot.backLabel,
          plot.depth2Label,
          plot.sideDimensions,
          plot.edgeSemantics,
          plot.polygon,
          plot.status,
          plot.notes,
          plot.featured,
          1,
          plot.updatedAt,
        ),
      ),
    );
  }
  const bindings: EdgeBinding[] = [];
  for (const plot of saved) {
    if (!plot.polygon || !plot.edgeSemantics) continue;
    try {
      const polygon = JSON.parse(plot.polygon) as unknown[];
      if (!Array.isArray(polygon) || polygon.length < 3) continue;
      const semantics = parsePlotSideSemantics(plot.edgeSemantics, polygon.length);
      if (!semantics) continue;
      const layout =
        semantics.layout === "three" || polygon.length === 3 ? "three" : "four";
      const front = semantics.roles.front?.[0];
      const back = semantics.roles.back?.[0];
      const depthA = semantics.roles.depthA?.[0];
      const depthB = semantics.roles.depthB?.[0];
      if (![front, back, depthA].every(Number.isInteger)) continue;
      if (layout === "four" && !Number.isInteger(depthB)) continue;
      bindings.push({
        id: plot.id,
        pointCount: polygon.length,
        front: Number(front),
        back: Number(back),
        depthA: Number(depthA),
        depthB: layout === "three" ? null : Number(depthB),
        roadFacingRoles: semantics.roadFacingRoles || ["front"],
      });
    } catch {
      // Binding metadata must never block the canonical plot save.
    }
  }
  await syncMeasurementBindings(projectId, bindings, now);
  return saved;
}

async function readCadGeometry(projectId: string) {
  const object = await env.BUCKET.get(`projects/${projectId}/mapper/cadGeometry`);
  if (!object) return null;
  try {
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const actor = await requireSuperAdmin();
  if (!actor) return denied();
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  if (!(await projectExists(projectId)))
    return Response.json({ error: "Project नहीं मिला" }, { status: 404 });
  const [plots, settings, cadGeometry] = await Promise.all([
    env.DB.prepare(
      "SELECT id,sqft,sqm,sqyd,dimensions,road,front,depth,dimension_unit AS dimensionUnit,front_edge_index AS frontEdgeIndex,depth_edge_index AS depthEdgeIndex,back_edge_index AS backEdgeIndex,depth2_edge_index AS depth2EdgeIndex,front_label AS frontLabel,depth_label AS depthLabel,back AS back,depth2 AS depth2,back_label AS backLabel,depth2_label AS depth2Label,side_dimensions AS sideDimensions,edge_semantics AS edgeSemantics,status,notes,featured,polygon FROM plots WHERE project_id=? AND inventory_active=1 ORDER BY id",
    )
      .bind(projectId)
      .all(),
    env.DB.prepare("SELECT key,value FROM settings WHERE project_id=?")
      .bind(projectId)
      .all<{ key: string; value: string }>(),
    readCadGeometry(projectId),
  ]);
  return Response.json(
    {
      plots: plots.results,
      settings: Object.fromEntries(
        settings.results.map((item) => [item.key, item.value]),
      ),
      cadGeometry,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const actor = await requireSuperAdmin();
  if (!actor) return denied();
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const projectId = String(form.get("projectId") || "");
    const kind = String(form.get("kind") || "");
    const file = form.get("file");
    if (projectId === COMPLETED_PROJECT_ID && ["masterplan", "sourceCad", "plotSheet"].includes(kind)) {
      return Response.json(
        { error: "Completed Tiyansh mapper locked है। नए काम के लिए नया project चुनें।" },
        { status: 409 },
      );
    }
    if (!(await projectExists(projectId)))
      return Response.json({ error: "Project नहीं मिला" }, { status: 404 });
    if (!(file instanceof File))
      return Response.json({ error: "File नहीं मिली" }, { status: 400 });

    const extension = file.name.toLowerCase().split(".").pop() || "";
    const valid =
      (kind === "masterplan" && imageUploadLooksValid(file)) ||
      (kind === "logo" && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) ||
      (kind === "sourcePdf" && (file.type === "application/pdf" || extension === "pdf")) ||
      (kind === "sourceCad" && ["dwg", "dxf"].includes(extension)) ||
      (kind === "plotSheet" && ["csv", "json"].includes(extension)) ||
      (kind === "plotSheetPreflight" && ["csv", "json"].includes(extension)) ||
      (kind === "measurementSheet" && ["csv", "json"].includes(extension)) ||
      (kind === "roadAccessSheet" && extension === "csv") ||
      (kind === "sideMappingSheet" && extension === "csv");
    if (!valid)
      return Response.json(
        { error: "Image, PDF, DWG/DXF, plot/measurement CSV/JSON ya correction CSV sahi format me choose karein" },
        { status: 400 },
      );

    const limits: Record<string, number> = {
      masterplan: 20 * 1024 * 1024,
      logo: 512 * 1024,
      sourcePdf: 25 * 1024 * 1024,
      sourceCad: 25 * 1024 * 1024,
      plotSheet: 3 * 1024 * 1024,
      plotSheetPreflight: 3 * 1024 * 1024,
      measurementSheet: 2 * 1024 * 1024,
      roadAccessSheet: 1 * 1024 * 1024,
      sideMappingSheet: 1 * 1024 * 1024,
    };
    if (file.size > (limits[kind] || 0))
      return Response.json({ error: "File बहुत बड़ी है" }, { status: 400 });

    const now = new Date().toISOString();
    const objectKey = `projects/${projectId}/mapper/${kind}`;

    if (kind === "logo") {
      // A published customer site must keep the previous logo until Publish Update.
      try {
        await freezeCurrentPublishedAssets(projectId, ["logo"]);
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Published logo preserve nahi hua",
          },
          { status: 409 },
        );
      }
      await env.BUCKET.put(objectKey, file.stream(), {
        httpMetadata: { contentType: file.type || "image/webp" },
      });
      const version = String(Date.now());
      await Promise.all([
        writeSetting(projectId, "logoName", file.name.slice(0, 240), now),
        writeSetting(projectId, "logoVersion", version, now),
      ]);
      await writeAudit(actor, "mapper.logo_uploaded", projectId, null, {
        filename: file.name,
        size: file.size,
        version,
      });
      return Response.json({
        ok: true,
        name: file.name,
        logoVersion: version,
        url: `/api/project-asset/logo?projectId=${encodeURIComponent(projectId)}&v=${version}`,
      });
    }

    if (kind === "masterplan") {
      // Preserve the currently published masterplan before replacing the editable
      // canonical source. Preview/mapper sees the new source; public stays frozen.
      try {
        await freezeCurrentPublishedAssets(projectId, ["masterplan"]);
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Published masterplan preserve nahi hua",
          },
          { status: 409 },
        );
      }
      const width = Math.round(Number(form.get("mapWidth")));
      const height = Math.round(Number(form.get("mapHeight")));
      const originalWidth = Math.round(Number(form.get("originalWidth")));
      const originalHeight = Math.round(Number(form.get("originalHeight")));
      if (!(width > 100 && height > 100 && width <= 10000 && height <= 10000)) {
        return Response.json({ error: "Masterplan dimensions invalid hain" }, { status: 400 });
      }

      const originalFile = form.get("originalFile");
      const publicFile = form.get("publicFile");
      const originalUploadCompleted = String(form.get("originalUploadCompleted") || "") === "1";
      const originalObjectToken = String(form.get("originalObjectToken") || "");
      const originalFileName = String(form.get("originalFileName") || "").slice(0, 240);
      const originalFileSize = Number(form.get("originalFileSize") || 0);

      if (
        originalFile instanceof File &&
        (!imageUploadLooksValid(originalFile) || originalFile.size > 40 * 1024 * 1024)
      )
        return Response.json(
          { error: "Legacy original masterplan 40 MB se chhota hona chahiye" },
          { status: 400 },
        );
      if (
        publicFile instanceof File &&
        (!imageUploadLooksValid(publicFile) || publicFile.size > 4 * 1024 * 1024)
      )
        return Response.json({ error: "Public masterplan invalid hai" }, { status: 400 });

      const usingMultipartOriginal =
        originalUploadCompleted &&
        /^[a-zA-Z0-9_-]{12,80}$/.test(originalObjectToken);
      if (originalUploadCompleted && !usingMultipartOriginal)
        return Response.json(
          { error: "Original masterplan multipart token invalid hai" },
          { status: 400 },
        );

      if (usingMultipartOriginal) {
        const uploadedOriginal = await env.BUCKET.head(
          `projects/${projectId}/mapper/masterplanOriginal/${originalObjectToken}`,
        );
        if (!uploadedOriginal)
          return Response.json(
            { error: "Original masterplan multipart upload complete nahi hua" },
            { status: 409 },
          );
        if (
          Number.isFinite(originalFileSize) &&
          originalFileSize > 0 &&
          uploadedOriginal.size !== Math.round(originalFileSize)
        )
          return Response.json(
            { error: "Original masterplan size verify nahi hui" },
            { status: 409 },
          );
      }

      // Bind each working image to its exact immutable source. A legacy upload
      // without a source explicitly disables stale-original/settings fallback.
      const resolvedOriginalToken = usingMultipartOriginal
        ? originalObjectToken
        : originalFile instanceof File
          ? crypto.randomUUID().replaceAll("-", "")
          : "";
      const masterplanOriginalKey = resolvedOriginalToken
        ? `projects/${projectId}/mapper/masterplanOriginal/${resolvedOriginalToken}`
        : "";
      const writes: Promise<unknown>[] = [
        env.BUCKET.put(objectKey, file.stream(), {
          httpMetadata: { contentType: file.type || "application/octet-stream" },
          customMetadata: { masterplanOriginalKey },
        }),
      ];
      if (originalFile instanceof File && !usingMultipartOriginal) {
        writes.push(
          env.BUCKET.put(masterplanOriginalKey, originalFile.stream(), {
            httpMetadata: { contentType: originalFile.type || "application/octet-stream" },
          }),
        );
      }
      if (publicFile instanceof File) {
        writes.push(
          env.BUCKET.put(`projects/${projectId}/mapper/masterplanPublic`, publicFile.stream(), {
            httpMetadata: { contentType: publicFile.type || "application/octet-stream" },
          }),
        );
      } else {
        writes.push(
          env.BUCKET.put(`projects/${projectId}/mapper/masterplanPublic`, file.stream(), {
            httpMetadata: { contentType: file.type || "application/octet-stream" },
          }),
        );
      }
      await Promise.all(writes);

      const version = String(Date.now());
      const resolvedOriginalName =
        (usingMultipartOriginal ? originalFileName : originalFile instanceof File ? originalFile.name : file.name)
          .slice(0, 240);

      await Promise.all([
        writeSetting(projectId, "masterplanName", file.name.slice(0, 240), now),
        writeSetting(projectId, "masterplanOriginalName", resolvedOriginalName, now),
        writeSetting(projectId, "masterplanVersion", version, now),
        writeSetting(projectId, "mapWidth", String(width), now),
        writeSetting(projectId, "mapHeight", String(height), now),
        writeSetting(projectId, "masterplanOriginalWidth", String(originalWidth || width), now),
        writeSetting(projectId, "masterplanOriginalHeight", String(originalHeight || height), now),
        ...(resolvedOriginalToken
          ? [
              writeSetting(
                projectId,
                "masterplanOriginalObjectToken",
                resolvedOriginalToken,
                now,
              ),
            ]
          : []),
      ]);

      // Source-less legacy replacements must not retain a different image's token.
      if (!resolvedOriginalToken) {
        await deleteSettings(projectId, ["masterplanOriginalObjectToken"]);
      }

      // A new render can have different perspective even with identical dimensions.
      // Keep already-published normalized polygons and inventory, but never reuse a
      // stale CAD->image calibration for future automatic publishes.
      await deleteSettings(projectId, [
        "homography",
        "calibrationPairs",
        "calibrationError",
        "cadMatchedCount",
        "cadReviewCount",
      ]);
      await writeAudit(actor, "mapper.masterplan_uploaded", projectId, null, {
        filename: file.name,
        originalFilename: resolvedOriginalName,
        originalSize:
          usingMultipartOriginal && Number.isFinite(originalFileSize)
            ? Math.round(originalFileSize)
            : originalFile instanceof File
              ? originalFile.size
              : null,
        originalStorage: usingMultipartOriginal ? "multipart-versioned" : "legacy-inline",
        size: file.size,
        width,
        height,
        version,
      });
      return Response.json({
        ok: true,
        name: file.name,
        mapWidth: width,
        mapHeight: height,
        masterplanVersion: version,
        url: `/api/project-asset/masterplan?projectId=${encodeURIComponent(projectId)}&v=${version}`,
      });
    }

    if (kind === "sourceCad") {
      await env.BUCKET.put(objectKey, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });
      await writeSetting(projectId, "sourceCadName", file.name.slice(0, 240), now);
      await deleteSettings(projectId, [
        "homography",
        "calibrationPairs",
        "calibrationError",
        "cadMatchedCount",
        "cadReviewCount",
        "cadParseError",
        "cadBounds",
        "cadCandidateCount",
      ]);
      let geometry = null;
      let cadError = "";
      try {
        geometry = await parseCadGeometry(file);
        await env.BUCKET.put(
          `projects/${projectId}/mapper/cadGeometry`,
          JSON.stringify(geometry),
          { httpMetadata: { contentType: "application/json" } },
        );
        await Promise.all([
          writeSetting(projectId, "cadBounds", JSON.stringify(geometry.bounds), now),
          writeSetting(projectId, "cadCandidateCount", String(geometry.candidates.length), now),
        ]);
      } catch (error) {
        cadError = error instanceof Error ? error.message : "CAD auto-detect nahi hua";
        await env.BUCKET.delete(`projects/${projectId}/mapper/cadGeometry`);
        await writeSetting(projectId, "cadParseError", cadError.slice(0, 500), now);
        await writeSetting(projectId, "cadCandidateCount", "0", now);
      }
      await writeAudit(actor, "mapper.sourceCad_uploaded", projectId, null, {
        filename: file.name,
        size: file.size,
        candidates: geometry?.candidates.length || 0,
        cadError,
      });
      return Response.json({
        ok: true,
        name: file.name,
        cadGeometry: geometry,
        cadError,
      });
    }

    if (kind === "sideMappingSheet") {
      let rows;
      const sourceText = await file.text();
      try {
        rows = parseSideMappingSheetText(sourceText);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Side Mapping CSV parse nahi hui" },
          { status: 400 },
        );
      }
      if (!rows.length)
        return Response.json({ error: "Side Mapping CSV me valid rows nahi mili" }, { status: 400 });

      const plotRows = await env.DB.prepare(
        "SELECT id,polygon,edge_semantics AS edgeSemantics FROM plots WHERE project_id=? AND inventory_active=1",
      )
        .bind(projectId)
        .all<{ id: string; polygon: string | null; edgeSemantics: string | null }>();
      const byId = new Map(plotRows.results.map((item) => [item.id, item]));
      const unknown = rows.filter((row) => !byId.has(row.id)).map((row) => row.id);
      if (unknown.length) {
        return Response.json(
          { error: "Side Mapping CSV me unknown Plot ID mile: " + unknown.slice(0, 12).join(", ") },
          { status: 400 },
        );
      }

      const rotationRow = await env.DB.prepare(
        "SELECT value FROM settings WHERE project_id=? AND key='publicRotation' LIMIT 1",
      )
        .bind(projectId)
        .first<{ value: string }>();
      const rawRotation = Number(rotationRow?.value || 0);
      const rotation =
        rawRotation === 1 || rawRotation === 2 || rawRotation === 3 ? rawRotation : 0;

      const updates = rows.map((row) => {
        const stored = byId.get(row.id)!;
        let polygon: [number, number][];
        try {
          polygon = JSON.parse(stored.polygon || "[]");
        } catch {
          throw new Error(`Plot ${row.id}: polygon invalid hai`);
        }
        if (!Array.isArray(polygon) || polygon.length < 4)
          throw new Error(`Plot ${row.id}: kam se kam 4-corner polygon chahiye`);

        const resolved = resolveFourSideEdges(polygon, row.front, rotation);
        if (!resolved)
          throw new Error(`Plot ${row.id}: 4 distinct side edges resolve nahi hui`);
        const oldSemantics = parsePlotSideSemantics(
          stored.edgeSemantics,
          polygon.length,
        );
        const resolvedSemantics = parsePlotSideSemantics(
          resolved.edgeSemantics,
          polygon.length,
        );
        const edgeSemantics =
          resolvedSemantics
            ? serializePlotSideSemantics(
                polygon.length,
                resolvedSemantics.roles,
                resolvedSemantics.layout,
                oldSemantics?.roadFacingRoles || [],
                oldSemantics?.facingDirectionOverrides || {},
              ) || resolved.edgeSemantics
            : resolved.edgeSemantics;
        return {
          id: row.id,
          pointCount: polygon.length,
          ...resolved,
          edgeSemantics,
          roadFacingRoles: oldSemantics?.roadFacingRoles || ["front"],
        };
      });

      await env.DB.batch(
        updates.map((row) =>
          env.DB.prepare(
            "UPDATE plots SET front_edge_index=?,back_edge_index=?,depth_edge_index=?,depth2_edge_index=?,edge_semantics=?,updated_at=? WHERE project_id=? AND id=?",
          ).bind(row.front, row.back, row.depthA, row.depthB, row.edgeSemantics, now, projectId, row.id),
        ),
      );
      await syncMeasurementBindings(projectId, updates, now);

      await env.BUCKET.put(objectKey, sourceText, {
        httpMetadata: { contentType: "text/csv; charset=utf-8" },
      });
      await Promise.all([
        writeSetting(projectId, "sideMappingSheetName", file.name.slice(0, 240), now),
        writeSetting(projectId, "sideMappingSheetCount", String(updates.length), now),
      ]);
      await writeAudit(actor, "mapper.sideMapping_imported", projectId, null, {
        filename: file.name,
        count: updates.length,
        updatedFields: ["front_edge_index", "back_edge_index", "depth_edge_index", "depth2_edge_index", "edge_semantics"],
      });
      return Response.json({ ok: true, name: file.name, count: updates.length });
    }

    if (kind === "measurementSheet") {
      const sourceText = await file.text();
      let rows;
      try {
        rows = parsePlotMeasurementSheetText(sourceText, file.name);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Measurement sheet parse nahi hui" },
          { status: 400 },
        );
      }
      if (!rows.length)
        return Response.json({ error: "Measurement sheet me valid rows nahi mili" }, { status: 400 });
      if (rows.length > 2000)
        return Response.json(
          { error: "Ek measurement sheet me adhiktam 2000 rows rakhein" },
          { status: 400 },
        );

      const plotRows = await env.DB.prepare(
        "SELECT id,polygon,road,edge_semantics AS edgeSemantics,front_edge_index AS frontEdgeIndex,back_edge_index AS backEdgeIndex,depth_edge_index AS depthEdgeIndex,depth2_edge_index AS depth2EdgeIndex FROM plots WHERE project_id=? AND inventory_active=1",
      )
        .bind(projectId)
        .all<{
          id: string;
          polygon: string | null;
          road: string | null;
          edgeSemantics: string | null;
          frontEdgeIndex: number | null;
          backEdgeIndex: number | null;
          depthEdgeIndex: number | null;
          depth2EdgeIndex: number | null;
        }>();
      const byId = new Map(plotRows.results.map((item) => [item.id, item]));
      const unknown = rows.filter((row) => !byId.has(row.id)).map((row) => row.id);
      if (unknown.length) {
        return Response.json(
          {
            error:
              "Measurement sheet me unknown Plot ID mile: " +
              unknown.slice(0, 12).join(", ") +
              (unknown.length > 12 ? "..." : ""),
          },
          { status: 400 },
        );
      }

      const plotUpdates = rows.map((row) =>
        env.DB.prepare(
          "UPDATE plots SET front=COALESCE(?,front),back=COALESCE(?,back),depth=COALESCE(?,depth),depth2=COALESCE(?,depth2),dimension_unit=CASE WHEN ?<>'' THEN ? ELSE dimension_unit END,front_label=CASE WHEN ?<>'' THEN ? ELSE front_label END,back_label=CASE WHEN ?<>'' THEN ? ELSE back_label END,depth_label=CASE WHEN ?<>'' THEN ? ELSE depth_label END,depth2_label=CASE WHEN ?<>'' THEN ? ELSE depth2_label END,side_dimensions=CASE WHEN ?<>'' THEN ? ELSE side_dimensions END,road=CASE WHEN ?<>'' THEN ? ELSE road END,updated_at=? WHERE project_id=? AND id=?",
        ).bind(
          row.front,
          row.back,
          row.depth,
          row.depth2,
          row.dimensionUnit,
          row.dimensionUnit,
          row.frontLabel,
          row.frontLabel,
          row.backLabel,
          row.backLabel,
          row.depthLabel,
          row.depthLabel,
          row.depth2Label,
          row.depth2Label,
          row.sideDimensions,
          row.sideDimensions,
          row.road,
          row.road,
          now,
          projectId,
          row.id,
        ),
      );
      for (let index = 0; index < plotUpdates.length; index += 80) {
        await env.DB.batch(plotUpdates.slice(index, index + 80));
      }

      const edgeWrites: ReturnType<typeof env.DB.prepare>[] = [];
      for (const row of rows) {
        const stored = byId.get(row.id)!;
        let pointCount = 0;
        try {
          const polygon = JSON.parse(stored.polygon || "[]");
          pointCount = Array.isArray(polygon) ? polygon.length : 0;
        } catch {
          pointCount = 0;
        }
        const parsedSemantics = parsePlotSideSemantics(
          stored.edgeSemantics,
          pointCount >= 3 ? pointCount : undefined,
        );
        const roadFacingRoles = new Set<PlotSideRole>(
          parsedSemantics?.roadFacingRoles?.length
            ? parsedSemantics.roadFacingRoles
            : ["front"],
        );
        const edgeFor = (role: "front" | "back" | "depthA" | "depthB") => {
          const semantic = parsedSemantics?.roles[role]?.[0];
          if (Number.isInteger(semantic)) return semantic as number;
          const fallback =
            role === "front"
              ? stored.frontEdgeIndex
              : role === "back"
                ? stored.backEdgeIndex
                : role === "depthA"
                  ? stored.depthEdgeIndex
                  : stored.depth2EdgeIndex;
          return Number.isInteger(fallback) ? Number(fallback) : null;
        };
        const roleRows = [
          ["front", row.front, row.frontLabel],
          ["back", row.back, row.backLabel],
          ["depthA", row.depth, row.depthLabel],
          ["depthB", row.depth2, row.depth2Label],
        ] as const;
        for (const [role, length, label] of roleRows) {
          if (length == null && !label) continue;
          const rawLabel =
            label || (length != null && row.dimensionUnit ? `${length} ${row.dimensionUnit}` : "");
          edgeWrites.push(
            env.DB.prepare(
              "INSERT INTO plot_edge_measurements (project_id,plot_id,role,segment_index,edge_index,point_count,length,unit,raw_label,road_frontage,road_access,source_ref,source_raw_text,confidence,verified,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,plot_id,role,segment_index) DO UPDATE SET edge_index=excluded.edge_index,point_count=excluded.point_count,length=COALESCE(excluded.length,length),unit=CASE WHEN excluded.unit<>'' THEN excluded.unit ELSE unit END,raw_label=CASE WHEN excluded.raw_label<>'' THEN excluded.raw_label ELSE raw_label END,road_frontage=excluded.road_frontage,road_access=CASE WHEN excluded.road_access<>'' THEN excluded.road_access ELSE road_access END,source_ref=CASE WHEN excluded.source_ref<>'' THEN excluded.source_ref ELSE source_ref END,source_raw_text=CASE WHEN excluded.source_raw_text<>'' THEN excluded.source_raw_text ELSE source_raw_text END,confidence=excluded.confidence,verified=excluded.verified,updated_at=excluded.updated_at",
            ).bind(
              projectId,
              row.id,
              role,
              0,
              edgeFor(role),
              pointCount >= 3 ? pointCount : null,
              length,
              row.dimensionUnit,
              rawLabel,
              roadFacingRoles.has(role) ? 1 : 0,
              row.road || stored.road || "",
              row.sourceRef || file.name,
              row.sourceRawText,
              row.confidence,
              row.verified ? 1 : 0,
              now,
            ),
          );
        }
      }
      for (let index = 0; index < edgeWrites.length; index += 80) {
        await env.DB.batch(edgeWrites.slice(index, index + 80));
      }

      const fullSidesCount = rows.filter((row) =>
        [
          row.front != null || Boolean(row.frontLabel),
          row.back != null || Boolean(row.backLabel),
          row.depth != null || Boolean(row.depthLabel),
          row.depth2 != null || Boolean(row.depth2Label),
        ].every(Boolean),
      ).length;
      const reviewCount = rows.filter(
        (row) => !row.verified || row.confidence !== "high",
      ).length;
      const verifiedCount = rows.length - reviewCount;

      await env.BUCKET.put(objectKey, sourceText, {
        httpMetadata: {
          contentType: file.name.toLowerCase().endsWith(".json")
            ? "application/json"
            : "text/csv; charset=utf-8",
        },
      });
      await Promise.all([
        writeSetting(projectId, "measurementSheetName", file.name.slice(0, 240), now),
        writeSetting(projectId, "measurementSheetCount", String(rows.length), now),
        writeSetting(projectId, "measurementSheetFullSidesCount", String(fullSidesCount), now),
        writeSetting(projectId, "measurementSheetVerifiedCount", String(verifiedCount), now),
        writeSetting(projectId, "measurementSheetReviewCount", String(reviewCount), now),
      ]);
      await writeAudit(actor, "mapper.measurementSheet_imported", projectId, null, {
        filename: file.name,
        count: rows.length,
        fullSidesCount,
        verifiedCount,
        reviewCount,
        updatedFields: [
          "front",
          "back",
          "depth",
          "depth2",
          "dimension_unit",
          "exact_labels",
          "plot_edge_measurements",
        ],
      });
      return Response.json({
        ok: true,
        name: file.name,
        count: rows.length,
        fullSidesCount,
        verifiedCount,
        reviewCount,
      });
    }

    if (kind === "roadAccessSheet") {
      let rows;
      const sourceText = await file.text();
      try {
        rows = parseRoadAccessSheetText(sourceText);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Road Access CSV parse nahi hui" },
          { status: 400 },
        );
      }
      if (!rows.length)
        return Response.json(
          { error: "Road Access CSV me valid non-blank rows nahi mili" },
          { status: 400 },
        );
      if (rows.length > 2000)
        return Response.json(
          { error: "Ek Road Access CSV me adhiktam 2000 rows rakhein" },
          { status: 400 },
        );

      // Safety contract: this importer never creates plots and never touches area,
      // dimensions, Front/Back/Depth, polygons, pricing, or Booked/Sold status.
      const existing = await env.DB.prepare(
        "SELECT id FROM plots WHERE project_id=? AND inventory_active=1",
      )
        .bind(projectId)
        .all<{ id: string }>();
      const existingIds = new Set(existing.results.map((item) => item.id));
      const unknown = rows.filter((row) => !existingIds.has(row.id)).map((row) => row.id);
      if (unknown.length) {
        return Response.json(
          {
            error:
              "Road Access CSV me unknown Plot ID mile: " +
              unknown.slice(0, 12).join(", ") +
              (unknown.length > 12 ? "…" : ""),
          },
          { status: 400 },
        );
      }

      await env.DB.batch(
        rows.map((row) =>
          env.DB.prepare(
            "UPDATE plots SET road=?,updated_at=? WHERE project_id=? AND id=?",
          ).bind(row.road, now, projectId, row.id),
        ),
      );

      // Save this source separately. Existing plotSheet object/settings remain untouched.
      await env.BUCKET.put(objectKey, sourceText, {
        httpMetadata: { contentType: "text/csv; charset=utf-8" },
      });
      await Promise.all([
        writeSetting(projectId, "roadAccessSheetName", file.name.slice(0, 240), now),
        writeSetting(projectId, "roadAccessSheetCount", String(rows.length), now),
      ]);
      await writeAudit(actor, "mapper.roadAccess_imported", projectId, null, {
        filename: file.name,
        count: rows.length,
        updatedFields: ["road"],
      });
      return Response.json({ ok: true, name: file.name, count: rows.length });
    }

    if (kind === "plotSheetPreflight") {
      let rows;
      try {
        rows = parsePlotSheetText(await file.text(), file.name, {
          sqmToSqftFactor: await projectSqmToSqftFactor(projectId),
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Plot sheet preflight parse nahi hui" },
          { status: 400 },
        );
      }
      if (!rows.length)
        return Response.json({ error: "Plot sheet me valid rows nahi mili" }, { status: 400 });
      if (rows.length > 2000)
        return Response.json(
          { error: "Ek project me adhiktam 2000 plot rows import karein" },
          { status: 400 },
        );

      const quality = assessPlotSheetRows(rows);
      const incomingIds = Array.from(new Set(rows.map((row) => row.id)));
      const inventory = await plotInventoryDiff(projectId, incomingIds);
      if (inventory.missingAdminDetailsIds.length) {
        return Response.json(
          {
            error: "Saved Owner / Booking Amount / Broker details wale plots ko inventory se remove nahi kar sakte. In plot IDs ko Plot Data me rakhein.",
            code: "PLOT_ADMIN_DETAILS_REMOVAL_BLOCKED",
            protectedPlotIds: inventory.missingAdminDetailsIds,
          },
          { status: 409 },
        );
      }
      await writeAudit(actor, "mapper.plotSheet_preflight", projectId, null, {
        filename: file.name,
        count: rows.length,
        richDetailReady: quality.richDetailReady,
        missingDimensions: quality.missingDimensions.length,
        missingRoad: quality.missingRoad.length,
        missingSideMeasurements: quality.missingSideMeasurements.length,
        partialSideMeasurements: quality.partialSideMeasurements.length,
        genericAreaOnlyDimensions: quality.genericAreaOnlyDimensions.length,
        missingFrontDirection: quality.missingFrontDirection.length,
        inventoryExisting: inventory.existingActiveCount,
        inventoryIncoming: inventory.incomingCount,
        inventoryAdded: inventory.addedIds.length,
        inventoryRestored: inventory.restoredIds.length,
        inventoryPendingRemoval: inventory.missingIds.length,
      });
      return Response.json({
        ok: true,
        name: file.name,
        count: rows.length,
        quality,
        inventory,
      });
    }

    if (kind === "plotSheet") {
      let rows;
      try {
        rows = parsePlotSheetText(await file.text(), file.name, {
          sqmToSqftFactor: await projectSqmToSqftFactor(projectId),
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Plot sheet parse nahi hui" },
          { status: 400 },
        );
      }
      if (!rows.length)
        return Response.json({ error: "Plot sheet me valid rows nahi mili" }, { status: 400 });
      if (rows.length > 2000)
        return Response.json({ error: "Ek project me adhiktam 2000 plot rows import karein" }, { status: 400 });
      const quality = assessPlotSheetRows(rows);
      const incomingIds = Array.from(new Set(rows.map((row) => row.id)));
      const inventory = await plotInventoryDiff(projectId, incomingIds);
      if (inventory.missingAdminDetailsIds.length) {
        return Response.json(
          {
            error: "Saved Owner / Booking Amount / Broker details wale plots ko inventory se remove nahi kar sakte. In plot IDs ko Plot Data me rakhein.",
            code: "PLOT_ADMIN_DETAILS_REMOVAL_BLOCKED",
            protectedPlotIds: inventory.missingAdminDetailsIds,
          },
          { status: 409 },
        );
      }
      const inventoryConfirmation = String(
        form.get("inventoryConfirmation") || "",
      );
      if (
        inventory.confirmationRequired &&
        inventoryConfirmation !== inventory.confirmationToken
      ) {
        return Response.json(
          {
            error:
              "Canonical Plot Data me existing plots missing hain. Inventory reconciliation confirm karein.",
            code: "PLOT_INVENTORY_CONFIRMATION_REQUIRED",
            reconciliationRequired: true,
            inventory,
          },
          { status: 409 },
        );
      }

      // Store only after parsing and inventory confirmation both succeed, so a
      // bad/accidental replacement never overwrites the last known-good source.
      await env.BUCKET.put(objectKey, file.stream(), {
        httpMetadata: { contentType: file.type || "text/csv" },
      });
      await writeSetting(projectId, "plotSheetName", file.name.slice(0, 240), now);
      const saved = await savePlots(
        projectId,
        rows.map((row) => ({ ...row, polygon: "", status: "available", featured: false })),
        true,
      );
      await setPlotInventoryActive(
        projectId,
        inventory.missingIds,
        false,
        now,
      );

      // Missing canonical rows are draft-inactive, not immediately deleted.
      // This preserves the currently published customer inventory/status/pricing
      // until Publish Update atomically promotes the new canonical inventory.
      // Normal new-project flow uses ONE canonical plot sheet. Front Direction
      // is stored even before polygons exist, then automatically converted to
      // canonical Front/Back/Depth A/Depth B edge semantics as soon as geometry
      // is available. Separate Side Mapping CSV remains an advanced correction tool.
      const directionRows = rows.filter((row) => row.frontDirection);
      const incomingIdSet = new Set(incomingIds);
      const existingDirectionSetting = await env.DB.prepare(
        "SELECT value FROM settings WHERE project_id=? AND key='plotFrontDirections' LIMIT 1",
      )
        .bind(projectId)
        .first<{ value: string }>();
      let existingDirections: Record<string, EdgeDirection> = {};
      try {
        const parsed = JSON.parse(existingDirectionSetting?.value || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existingDirections = Object.fromEntries(
            Object.entries(parsed).filter(
              (entry): entry is [string, EdgeDirection] =>
                incomingIdSet.has(entry[0]) &&
                ["top", "right", "bottom", "left"].includes(String(entry[1])),
            ),
          );
        }
      } catch {
        existingDirections = {};
      }
      const mergedDirections: Record<string, EdgeDirection> = {
        ...existingDirections,
      };
      for (const row of directionRows) {
        mergedDirections[row.id] = row.frontDirection as EdgeDirection;
      }
      if (
        existingDirectionSetting ||
        directionRows.length ||
        inventory.missingIds.length ||
        inventory.restoredIds.length
      ) {
        await writeSetting(
          projectId,
          "plotFrontDirections",
          JSON.stringify(mergedDirections),
          now,
        );
      }

      let autoSideMapped = 0;
      if (directionRows.length) {
        const [rotationRow, mappedRows] = await Promise.all([
          env.DB.prepare(
            "SELECT value FROM settings WHERE project_id=? AND key='publicRotation' LIMIT 1",
          )
            .bind(projectId)
            .first<{ value: string }>(),
          env.DB.prepare(
            "SELECT id,polygon,edge_semantics AS edgeSemantics FROM plots WHERE project_id=? AND inventory_active=1 AND TRIM(COALESCE(polygon,''))<>''",
          )
            .bind(projectId)
            .all<{ id: string; polygon: string; edgeSemantics: string | null }>(),
        ]);
        const rawRotation = Number(rotationRow?.value || 0);
        const rotation =
          rawRotation === 1 || rawRotation === 2 || rawRotation === 3
            ? rawRotation
            : 0;
        const mappedById = new Map(mappedRows.results.map((item) => [item.id, item]));
        const semanticUpdates: Array<EdgeBinding & { edgeSemantics: string }> = [];

        for (const row of directionRows) {
          const stored = mappedById.get(row.id);
          if (!stored) continue;
          let polygon: [number, number][];
          try {
            polygon = JSON.parse(stored.polygon || "[]");
          } catch {
            continue;
          }
          if (!Array.isArray(polygon) || polygon.length < 4) continue;
          const resolved = resolveFourSideEdges(
            polygon,
            row.frontDirection as EdgeDirection,
            rotation,
          );
          if (!resolved) continue;
          const oldSemantics = parsePlotSideSemantics(
            stored.edgeSemantics,
            polygon.length,
          );
          const resolvedSemantics = parsePlotSideSemantics(
            resolved.edgeSemantics,
            polygon.length,
          );
          const edgeSemantics =
            resolvedSemantics
              ? serializePlotSideSemantics(
                  polygon.length,
                  resolvedSemantics.roles,
                  resolvedSemantics.layout,
                  oldSemantics?.roadFacingRoles || [],
                  oldSemantics?.facingDirectionOverrides || {},
                ) || resolved.edgeSemantics
              : resolved.edgeSemantics;
          semanticUpdates.push({
            id: row.id,
            pointCount: polygon.length,
            ...resolved,
            edgeSemantics,
            roadFacingRoles: oldSemantics?.roadFacingRoles || ["front"],
          });
        }

        if (semanticUpdates.length) {
          await env.DB.batch(
            semanticUpdates.map((row) =>
              env.DB.prepare(
                "UPDATE plots SET front_edge_index=?,back_edge_index=?,depth_edge_index=?,depth2_edge_index=?,edge_semantics=?,updated_at=? WHERE project_id=? AND id=?",
              ).bind(
                row.front,
                row.back,
                row.depthA,
                row.depthB,
                row.edgeSemantics,
                now,
                projectId,
                row.id,
              ),
            ),
          );
          await syncMeasurementBindings(projectId, semanticUpdates, now);
          autoSideMapped = semanticUpdates.length;
        }
      }

      await writeSetting(projectId, "plotSheetCount", String(saved.length), now);
      await writeAudit(actor, "mapper.plotSheet_imported", projectId, null, {
        filename: file.name,
        count: saved.length,
        richDetailReady: quality.richDetailReady,
        fullDetailCount: quality.fullDetailCount,
        missingDimensions: quality.missingDimensions.length,
        missingRoad: quality.missingRoad.length,
        missingSideMeasurements: quality.missingSideMeasurements.length,
        partialSideMeasurements: quality.partialSideMeasurements.length,
        missingFrontDirection: quality.missingFrontDirection.length,
        autoSideMapped,
        inventoryExisting: inventory.existingActiveCount,
        inventoryIncoming: inventory.incomingCount,
        inventoryAdded: inventory.addedIds.length,
        inventoryRestored: inventory.restoredIds.length,
        inventoryPendingRemoval: inventory.missingIds.length,
        pendingRemovalIds: inventory.missingIds.slice(0, 100),
      });
      return Response.json({
        ok: true,
        name: file.name,
        count: saved.length,
        plots: saved,
        quality,
        autoSideMapped,
        inventory,
      });
    }

    // Technical PDF and future ordinary mapper source assets.
    await env.BUCKET.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    await writeSetting(projectId, `${kind}Name`, file.name.slice(0, 240), now);
    await writeAudit(actor, `mapper.${kind}_uploaded`, projectId, null, {
      filename: file.name,
      size: file.size,
    });
    return Response.json({
      ok: true,
      name: file.name,
      url: `/api/project-asset/${kind}?projectId=${encodeURIComponent(projectId)}&v=${Date.now()}`,
    });
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
    action?: "clear_all_polygons" | "clear_plot_boundary" | "add_inventory_plots";
    newPlots?: Record<string, unknown>[];
    confirmation?: string;
    plot?: Record<string, unknown>;
    plots?: Record<string, unknown>[];
    settings?: Record<string, unknown>;
  };
  const projectId = String(body.projectId || "");
  if (!(await projectExists(projectId)))
    return Response.json({ error: "Project नहीं मिला" }, { status: 404 });
  if (projectId === COMPLETED_PROJECT_ID)
    return Response.json({ error: "Completed Tiyansh mapper locked है" }, { status: 409 });

  if (body.action === "add_inventory_plots") {
    const rows = Array.isArray(body.newPlots) ? body.newPlots : [];
    if (!rows.length || rows.length > 100) {
      return Response.json({ error: "1 se 100 new plot rows required hain" }, { status: 400 });
    }
    const now = new Date().toISOString();
    let cleaned;
    try {
      cleaned = rows.map((row) => {
        const id = cleanPlotId(String(row.id || ""));
        const front = optionalPositiveMeasure(row.front);
        const back = optionalPositiveMeasure(row.back);
        const depth = optionalPositiveMeasure(row.depth);
        const depth2 = optionalPositiveMeasure(row.depth2);
        const unit = String(row.dimensionUnit || "").trim().toLowerCase();
        const hasDimensions = [front, back, depth, depth2].some((value) => value !== null);
        const area = Number(row.sqft || 0);
        const dimensions = String(row.dimensions || "").trim();
        if (!id) throw new Error("New plot ID missing hai");
        if (hasDimensions && unit !== "ft" && unit !== "m") {
          throw new Error(`Plot ${id}: dimensions ke liye Dimension Unit ft/m required hai`);
        }
        if (![front, back, depth, depth2].every((value) => value === null || (Number.isFinite(value) && value > 0))) {
          throw new Error(`Plot ${id}: side measurements positive numbers hone chahiye`);
        }
        if (!Number.isFinite(area) || area < 0) throw new Error(`Plot ${id}: area invalid hai`);
        return { id, front, back, depth, depth2, unit: hasDimensions ? unit : null, area, dimensions, road: String(row.road || "").trim().slice(0,160), notes: String(row.notes || "").trim().slice(0,2000) };
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "New shop data invalid hai" }, { status: 400 });
    }
    const ids = cleaned.map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      return Response.json({ error: "New plot rows me duplicate ID hai" }, { status: 400 });
    }
    const existing = await env.DB.prepare(
      `SELECT id FROM plots WHERE project_id=? AND id IN (${ids.map(() => "?").join(",")})`
    ).bind(projectId, ...ids).all<{ id: string }>();
    const existingIds = new Set(existing.results.map((row) => row.id));
    const collisions = ids.filter((id) => existingIds.has(id));
    if (collisions.length) {
      return Response.json({ error: "Ye plot IDs pehle se maujood hain: " + collisions.join(", ") }, { status: 409 });
    }
    const factor = await projectSqmToSqftFactor(projectId);
    const statements = cleaned.map((row) => {
      const sqm = row.area > 0 ? row.area / factor : 0;
      const sqyd = sqm > 0 ? sqm * 1.1959900463 : 0;
      return env.DB.prepare(
        "INSERT INTO plots (project_id,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit,front_edge_index,depth_edge_index,back_edge_index,depth2_edge_index,front_label,depth_label,back_label,depth2_label,side_dimensions,edge_semantics,polygon,status,notes,featured,inventory_active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(projectId,row.id,row.area,sqm,sqyd,row.dimensions,row.road,row.front,row.depth,row.back,row.depth2,row.unit,null,null,null,null,null,null,null,null,null,null,"","available",row.notes,0,1,now);
    });
    try {
      await env.DB.batch(statements);
    } catch {
      return Response.json({ error: "New shop inventory create nahi hui; existing rows untouched rahe" }, { status: 409 });
    }
    await writeAudit(actor, "mapper.inventory_plots_added", projectId, null, {
      count: cleaned.length, ids, polygonInitializedEmpty: true,
    });
    const created = await env.DB.prepare(
      `SELECT project_id AS projectId,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit AS dimensionUnit,front_edge_index AS frontEdgeIndex,depth_edge_index AS depthEdgeIndex,back_edge_index AS backEdgeIndex,depth2_edge_index AS depth2EdgeIndex,front_label AS frontLabel,depth_label AS depthLabel,back_label AS backLabel,depth2_label AS depth2Label,side_dimensions AS sideDimensions,edge_semantics AS edgeSemantics,polygon,status,notes,featured,inventory_active AS inventoryActive,updated_at AS updatedAt FROM plots WHERE project_id=? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id`
    ).bind(projectId, ...ids).all();
    if (created.results.length !== cleaned.length || created.results.some((row) => !row.inventoryActive || row.polygon)) {
      return Response.json({ error: "Shop create read-back verification failed; no success reported" }, { status: 409 });
    }
    return Response.json({ ok: true, count: created.results.length, plots: created.results });
  }

  if (body.action === "clear_plot_boundary") {
    const plotId = String(body.plot?.id || "").trim();
    if (!plotId) return Response.json({ error: "Plot ID missing hai" }, { status: 400 });
    const existing = await env.DB.prepare(
      "SELECT id FROM plots WHERE project_id=? AND id=? AND inventory_active=1 LIMIT 1",
    ).bind(projectId, plotId).first<{ id: string }>();
    if (!existing) return Response.json({ error: "Plot nahi mila" }, { status: 404 });

    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE plots SET polygon='',front_edge_index=NULL,back_edge_index=NULL,depth_edge_index=NULL,depth2_edge_index=NULL,edge_semantics=NULL,updated_at=? WHERE project_id=? AND id=? AND inventory_active=1",
      ).bind(now, projectId, plotId),
      env.DB.prepare(
        "UPDATE plot_edge_measurements SET edge_index=NULL,point_count=NULL,updated_at=? WHERE project_id=? AND plot_id=?",
      ).bind(now, projectId, plotId),
      env.DB.prepare(
        "INSERT INTO audit_logs (id,actor_id,actor_email,action,project_id,target_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).bind(crypto.randomUUID(),actor.id,actor.email,"mapper.boundary_removed",projectId,plotId,JSON.stringify({semanticBindingsReset:true}),now),
    ]);

    const cleared = await env.DB.prepare(
      `SELECT project_id AS projectId,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,
       dimension_unit AS dimensionUnit,front_edge_index AS frontEdgeIndex,
       depth_edge_index AS depthEdgeIndex,back_edge_index AS backEdgeIndex,
       depth2_edge_index AS depth2EdgeIndex,front_label AS frontLabel,
       depth_label AS depthLabel,back_label AS backLabel,depth2_label AS depth2Label,
       side_dimensions AS sideDimensions,edge_semantics AS edgeSemantics,
       polygon,status,notes,featured,inventory_active AS inventoryActive,updated_at AS updatedAt
       FROM plots WHERE project_id=? AND id=? LIMIT 1`,
    ).bind(projectId, plotId).first();
    return Response.json({ ok: true, plot: cleared });
  }

  if (body.action === "clear_all_polygons") {
    if (body.confirmation !== `CLEAR ${projectId}`) {
      return Response.json({ error: "Clear all confirmation invalid है" }, { status: 400 });
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM plots WHERE project_id=? AND inventory_active=1 AND TRIM(COALESCE(polygon,''))<>''",
    )
      .bind(projectId)
      .first<{ total: number }>();
    const cleared = Number(count?.total || 0);
    if (!cleared) return Response.json({ ok: true, cleared: 0 });

    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE plots SET polygon='',front_edge_index=NULL,back_edge_index=NULL,depth_edge_index=NULL,depth2_edge_index=NULL,edge_semantics=NULL,updated_at=? WHERE project_id=? AND inventory_active=1 AND TRIM(COALESCE(polygon,''))<>''",
      ).bind(now, projectId),
      env.DB.prepare(
        "UPDATE plot_edge_measurements SET edge_index=NULL,point_count=NULL,updated_at=? WHERE project_id=? AND plot_id IN (SELECT id FROM plots WHERE project_id=? AND inventory_active=1)",
      ).bind(now, projectId, projectId),
      env.DB.prepare(
        "INSERT INTO audit_logs (id,actor_id,actor_email,action,project_id,target_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        actor.id,
        actor.email,
        "mapper.all_boundaries_removed",
        projectId,
        null,
        JSON.stringify({ count: cleared }),
        now,
      ),
    ]);
    return Response.json({ ok: true, cleared });
  }

  if (body.settings && typeof body.settings === "object") {
    const entries = Object.entries(body.settings).filter(([key]) => SETTINGS_WHITELIST.has(key));
    if (!entries.length)
      return Response.json({ error: "Mapper settings invalid हैं" }, { status: 400 });
    const now = new Date().toISOString();
    try {
      for (const [key, raw] of entries) {
        const validated = validatedSetting(key, raw);
        await writeSetting(projectId, key, validated, now);
        if (key === "sqmToSqftFactor") {
          const factor = normalizeSqmToSqftFactor(validated);
          await env.DB.prepare(
            "UPDATE plots SET sqft=ROUND(sqm * ?, 3),updated_at=? WHERE project_id=? AND inventory_active=1 AND sqm>0",
          )
            .bind(factor, now, projectId)
            .run();
        }
      }
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Mapper settings invalid hain" },
        { status: 400 },
      );
    }
    await writeAudit(actor, "mapper.calibration_saved", projectId, null, {
      keys: entries.map(([key]) => key),
    });
    return Response.json({ ok: true });
  }

  const incoming = Array.isArray(body.plots) ? body.plots : body.plot ? [body.plot] : [];
  if (!incoming.length)
    return Response.json({ error: "Plot नहीं मिला" }, { status: 404 });
  if (incoming.length > 500)
    return Response.json({ error: "एक request में अधिकतम 500 plots रखें" }, { status: 400 });
  let saved;
  try {
    saved = await savePlots(projectId, incoming);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Plot data सही नहीं है" },
      { status: 400 },
    );
  }
  await writeAudit(
    actor,
    saved.length > 1
      ? "mapper.auto_plots_saved"
      : saved[0].polygon
        ? "mapper.plot_saved"
        : "mapper.boundary_removed",
    projectId,
    saved.length === 1 ? saved[0].id : null,
    { count: saved.length, ids: saved.map((plot) => plot.id) },
  );
  return Response.json({ ok: true, plot: saved[0], plots: saved });
}
