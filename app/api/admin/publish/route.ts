import { env } from "cloudflare:workers";
import { requireSuperAdmin, sameOrigin } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { activeProjectDomain } from "@/modules/domains";
import { currentProjectLinks } from "@/modules/projects";
import { missingRequiredProjectContact } from "@/modules/projects";
import {
  capturePublishedSnapshotStatements,
  finalizeInactivePlotInventoryStatements,
  promotePublishedAssets,
} from "@/modules/public-publish-snapshot";

const denied = () => Response.json({ error: "Super Admin access required" }, { status: 403 });
const LEGACY_PROJECT = "tiyansh-prime-square";

function validPolygon(raw: string) {
  try {
    const points = JSON.parse(raw);
    return (
      Array.isArray(points) &&
      points.length >= 3 &&
      points.length <= 80 &&
      points.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(
            (value) =>
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= 0 &&
              value <= 1,
          ),
      )
    );
  } catch {
    return false;
  }
}

type PublishPlotRow = {
  id: string;
  polygon: string;
  dimensions: string;
  road: string;
  front: number | null;
  back: number | null;
  depth: number | null;
  depth2: number | null;
  frontLabel: string | null;
  backLabel: string | null;
  depthLabel: string | null;
  depth2Label: string | null;
  sideDimensions: string | null;
  frontEdgeIndex: number | null;
  backEdgeIndex: number | null;
  depthEdgeIndex: number | null;
  depth2EdgeIndex: number | null;
};

function hasFourSideMeasurements(plot: PublishPlotRow) {
  const direct = [
    plot.front != null || Boolean(String(plot.frontLabel || "").trim()),
    plot.back != null || Boolean(String(plot.backLabel || "").trim()),
    plot.depth != null || Boolean(String(plot.depthLabel || "").trim()),
    plot.depth2 != null || Boolean(String(plot.depth2Label || "").trim()),
  ];
  if (direct.every(Boolean)) return true;
  const sides = String(plot.sideDimensions || "").toLowerCase();
  if (!sides.includes("front") || !sides.includes("back") || !sides.includes("depth"))
    return false;
  const measurements =
    sides.match(/\d+(?:\.\d+)?\s*(?:m\b|ft\b|'|feet\b|meter\b|metre\b)/gi) || [];
  return measurements.length >= 4;
}

function hasFourSideSemantics(plot: PublishPlotRow) {
  const indexes = [
    plot.frontEdgeIndex,
    plot.backEdgeIndex,
    plot.depthEdgeIndex,
    plot.depth2EdgeIndex,
  ];
  return indexes.every(
    (value) => value != null && Number.isInteger(Number(value)) && Number(value) >= 0,
  ) && new Set(indexes.map(Number)).size === 4;
}

function plotDetailWarnings(plots: PublishPlotRow[]) {
  if (!plots.length) return [] as string[];
  const missingDimensions = plots.filter(
    (plot) => !String(plot.dimensions || "").trim(),
  );
  const missingRoad = plots.filter((plot) => !String(plot.road || "").trim());
  const missingSides = plots.filter((plot) => !hasFourSideMeasurements(plot));
  const missingSemantics = plots.filter((plot) => !hasFourSideSemantics(plot));
  const genericAreaOnly = plots.filter(
    (plot) =>
      /approved\s+(?:plan\s+)?area|sanctioned\s+irregular\s+plot/i.test(
        String(plot.dimensions || ""),
      ) && !hasFourSideMeasurements(plot),
  );

  const warnings: string[] = [];
  if (missingDimensions.length)
    warnings.push(
      `${missingDimensions.length} plots me Dimensions missing hain`,
    );
  if (missingRoad.length)
    warnings.push(`${missingRoad.length} plots me Road Access missing hai`);
  if (missingSides.length)
    warnings.push(
      `${missingSides.length} plots me Front / Back / Depth A / Depth B incomplete hain`,
    );
  if (missingSemantics.length)
    warnings.push(
      `${missingSemantics.length} plots me Front/Back/Depth edge mapping incomplete hai`,
    );
  if (genericAreaOnly.length)
    warnings.push(
      `${genericAreaOnly.length} plots generic approved-area text par hain; exact side details verify karein`,
    );
  return warnings;
}

async function publishState(projectId: string) {
  const project = await env.DB.prepare(
    "SELECT id,name,slug,kind,status,public_status AS publicStatus,published_at AS publishedAt,publish_version AS publishVersion,public_host AS publicHost,admin_host AS adminHost FROM projects WHERE id=? AND status!='deleted' LIMIT 1",
  )
    .bind(projectId)
    .first<{
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
    }>();
  if (!project) return null;

  const [plotResult, settingsResult, protectedRemovalResult, saleProtectedResult] = await Promise.all([
    env.DB.prepare(
      "SELECT id,polygon,dimensions,road,front,back,depth,depth2,front_label AS frontLabel,back_label AS backLabel,depth_label AS depthLabel,depth2_label AS depth2Label,side_dimensions AS sideDimensions,front_edge_index AS frontEdgeIndex,back_edge_index AS backEdgeIndex,depth_edge_index AS depthEdgeIndex,depth2_edge_index AS depth2EdgeIndex FROM plots WHERE project_id=? AND inventory_active=1 ORDER BY id",
    )
      .bind(projectId)
      .all<PublishPlotRow>(),
    env.DB.prepare(
      "SELECT key,value FROM settings WHERE project_id=? AND key IN ('masterplanName','mapWidth','mapHeight','shareTitle','shareDescription','shareImage','location','address','phone1')",
    )
      .bind(projectId)
      .all<{ key: string; value: string }>(),
    env.DB.prepare(
      `SELECT p.id FROM plots p
       JOIN plot_admin_details ad ON ad.project_id=p.project_id AND ad.plot_id=p.id
       WHERE p.project_id=? AND p.inventory_active=0
         AND (COALESCE(TRIM(ad.owner_name),'')<>''
           OR ad.booking_amount_paise IS NOT NULL
           OR COALESCE(TRIM(ad.broker_name),'')<>'')
       ORDER BY p.id`,
    ).bind(projectId).all<{ id: string }>(),
    env.DB.prepare(
      `SELECT p.id FROM plots p JOIN property_sales s ON s.project_id=p.project_id AND s.plot_id=p.id
       WHERE p.project_id=? AND p.inventory_active=0 GROUP BY p.id ORDER BY p.id`,
    ).bind(projectId).all<{ id: string }>(),
  ]);

  const settings = Object.fromEntries(
    settingsResult.results.map((item) => [item.key, item.value]),
  );
  const plots = plotResult.results;
  const mapped = plots.filter((plot) => Boolean(plot.polygon)).length;
  const invalid = plots.filter(
    (plot) => Boolean(plot.polygon) && !validPolygon(plot.polygon),
  ).length;
  const legacy = projectId === LEGACY_PROJECT;
  const geoLab = project.kind === "geo_lab";
  const reasons: string[] = [];
  const warnings = legacy ? [] : plotDetailWarnings(plots);
  if (protectedRemovalResult.results.length) {
    reasons.push(
      `${protectedRemovalResult.results.length} removed plots me saved Owner / Booking Amount / Broker details hain. In plots ko inventory me restore karke Publish karein.`,
    );
  }

  if (saleProtectedResult.results.length) {
    reasons.push(
      `${saleProtectedResult.results.length} removed plots have recorded Sales/Payments. Restore them before Publish Update; financial records cannot be silently deleted.`,
    );
  }

  if (!legacy) {
    if (geoLab) reasons.push("Geo Lab project public publish ke liye locked hai");
    if (!settings.masterplanName) reasons.push("Masterplan image upload required");
    if (!settings.mapWidth || !settings.mapHeight) reasons.push("Masterplan dimensions missing");
    if (!settings.shareTitle) reasons.push("Share title required");
    if (!settings.shareDescription) reasons.push("Share description required");
    if (!settings.shareImage) reasons.push("Share preview image required");
    for (const key of missingRequiredProjectContact(settings)) {
      if (key === "location") reasons.push("Project location required");
      if (key === "address") reasons.push("Full address required");
      if (key === "phone1") reasons.push("Primary phone required");
    }
    if (!plots.length) reasons.push("Plot inventory empty");
    if (mapped !== plots.length)
      reasons.push(`${plots.length - mapped} plots ki boundary pending hai`);
    if (invalid) reasons.push(`${invalid} invalid polygon boundaries hain`);
  }

  const [primaryDomain, primaryAdminDomain] = await Promise.all([
    activeProjectDomain(projectId, "public"),
    activeProjectDomain(projectId, "admin"),
  ]);
  const links = currentProjectLinks(
    project.slug,
    primaryDomain || project.publicHost,
    primaryAdminDomain || project.adminHost,
  );

  return {
    ...project,
    total: plots.length,
    mapped,
    invalid,
    masterplanReady: legacy || Boolean(settings.masterplanName),
    ready: reasons.length === 0,
    reasons,
    warnings,
    detailQualityReady: warnings.length === 0,
    primaryDomain: primaryDomain || project.publicHost,
    primaryAdminDomain: primaryAdminDomain || project.adminHost,
    ...links,
    legacy,
    geoLab,
  };
}

export async function GET(request: Request) {
  const actor = await requireSuperAdmin();
  if (!actor) return denied();
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project required" }, { status: 400 });
  const state = await publishState(projectId);
  if (!state) return Response.json({ error: "Project nahi mila" }, { status: 404 });
  return Response.json(state, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireSuperAdmin();
  if (!actor) return denied();
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
    action?: "publish" | "unpublish";
  };
  const projectId = String(body.projectId || "");
  const action = body.action;
  if (!projectId || !["publish", "unpublish"].includes(String(action)))
    return Response.json({ error: "Invalid publish request" }, { status: 400 });

  const state = await publishState(projectId);
  if (!state) return Response.json({ error: "Project nahi mila" }, { status: 404 });

  const now = new Date().toISOString();
  if (action === "publish") {
    if (state.geoLab)
      return Response.json(
        { error: "Geo Lab project ko public publish nahi kiya ja sakta" },
        { status: 409 },
      );
    if (!state.ready)
      return Response.json(
        { error: "Project publish-ready nahi hai", reasons: state.reasons },
        { status: 409 },
      );
    const nextVersion = Number(state.publishVersion || 0) + 1;
    try {
      // Freeze the exact masterplan/logo bytes before the D1 publish pointer moves.
      // Orphaned versioned R2 objects are harmless if the following D1 transaction
      // fails; the same version is overwritten on the next publish attempt.
      await promotePublishedAssets(projectId, nextVersion);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Published assets snapshot nahi bana",
        },
        { status: 409 },
      );
    }

    await env.DB.batch([
      ...capturePublishedSnapshotStatements(projectId, nextVersion, now),
      env.DB.prepare(
        "UPDATE projects SET public_status='published',published_at=?,publish_version=?,updated_at=? WHERE id=?",
      ).bind(now, nextVersion, now, projectId),
      ...finalizeInactivePlotInventoryStatements(projectId),
    ]);
    await writeAudit(actor, "project.published", projectId, null, {
      mapped: state.mapped,
      total: state.total,
      previousVersion: state.publishVersion,
      publishVersion: nextVersion,
      structuralSnapshot: true,
      detailQualityWarnings: state.warnings,
    });
  } else {
    if (projectId === LEGACY_PROJECT)
      return Response.json(
        { error: "Tiyansh legacy reference ko unpublish nahi kiya ja sakta" },
        { status: 409 },
      );
    await env.DB.prepare(
      "UPDATE projects SET public_status='draft',updated_at=? WHERE id=?",
    )
      .bind(now, projectId)
      .run();
    await writeAudit(actor, "project.unpublished", projectId, null);
  }

  const next = await publishState(projectId);
  return Response.json(next, { headers: { "cache-control": "no-store" } });
}
