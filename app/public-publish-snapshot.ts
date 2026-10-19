import { env } from "cloudflare:workers";

export const PUBLISHED_SETTING_KEYS = [
  "projectName",
  "brandName",
  "brandShort",
  "template",
  "accentColor",
  "plotStatusAvailableColor",
  "plotStatusBookedColor",
  "plotStatusSoldColor",
  "pricingEnabled",
  "customerCallEnabled",
  "plotFacingEnabled",
  "plotNorthDirection",
  "publicInitialViewMode",
  "publicInitialFocusX",
  "publicInitialFocusY",
  "location",
  "address",
  "phone1",
  "phone2",
  "whatsapp",
  "mapUrl",
  "brochureUrl",
  "masterplanName",
  "mapWidth",
  "mapHeight",
  "sqmToSqftFactor",
  "publicRotation",
  "masterplanNorthAngle",
  "logoName",
  "logoVersion",
  "shareTitle",
  "shareDescription",
  "shareImage",
  "shareVersion",
  "shareTemplate",
] as const;

export type PublishedAssetKind = "masterplan" | "masterplanPublic" | "logo";

export function publishedAssetKey(
  projectId: string,
  publishVersion: number,
  kind: PublishedAssetKind,
) {
  return `projects/${projectId}/published/${publishVersion}/${kind}`;
}

function canonicalAssetKey(projectId: string, kind: PublishedAssetKind) {
  return `projects/${projectId}/mapper/${kind}`;
}

async function copyR2Object(
  sourceKey: string,
  destinationKey: string,
  overwrite = false,
) {
  if (!overwrite && (await env.BUCKET.head(destinationKey))) return true;

  const source = await env.BUCKET.get(sourceKey);
  if (!source) return false;

  await env.BUCKET.put(destinationKey, source.body, {
    httpMetadata: {
      contentType:
        source.httpMetadata?.contentType || "application/octet-stream",
    },
    customMetadata: {
      source: "rekixo-publish-snapshot",
      sourceKey,
    },
  });
  return true;
}

export async function freezeCurrentPublishedAssets(
  projectId: string,
  kinds: Array<"masterplan" | "logo">,
) {
  const project = await env.DB.prepare(
    "SELECT public_status AS publicStatus,publish_version AS publishVersion FROM projects WHERE id=? AND status='active' LIMIT 1",
  )
    .bind(projectId)
    .first<{ publicStatus: string; publishVersion: number }>();

  const version = Number(project?.publishVersion ?? 0);
  if (project?.publicStatus !== "published" || !Number.isFinite(version) || version < 0) return;

  if (kinds.includes("masterplan")) {
    const canonical = canonicalAssetKey(projectId, "masterplan");
    const publicCanonical = canonicalAssetKey(projectId, "masterplanPublic");
    const publishedCanonical = publishedAssetKey(projectId, version, "masterplan");
    const publishedPublic = publishedAssetKey(projectId, version, "masterplanPublic");

    const frozenCanonical = await copyR2Object(
      canonical,
      publishedCanonical,
      false,
    );
    if (!frozenCanonical) {
      throw new Error(
        "Current published masterplan missing hai; safe replacement blocked",
      );
    }
    const frozenPublic = await copyR2Object(
      publicCanonical,
      publishedPublic,
      false,
    );
    if (!frozenPublic) {
      await copyR2Object(canonical, publishedPublic, false);
    }
  }

  if (kinds.includes("logo")) {
    const publishedLogo = await env.DB.prepare(
      "SELECT value FROM published_settings WHERE project_id=? AND key='logoName' LIMIT 1",
    )
      .bind(projectId)
      .first<{ value: string }>();
    if (String(publishedLogo?.value || "").trim()) {
      const frozenLogo = await copyR2Object(
        canonicalAssetKey(projectId, "logo"),
        publishedAssetKey(projectId, version, "logo"),
        false,
      );
      if (!frozenLogo) {
        throw new Error(
          "Current published logo missing hai; safe replacement blocked",
        );
      }
    }
  }
}

export async function freezeCurrentPublishedShareCard(projectId: string) {
  const project = await env.DB.prepare(
    "SELECT public_status AS publicStatus FROM projects WHERE id=? AND status='active' LIMIT 1",
  )
    .bind(projectId)
    .first<{ publicStatus: string }>();
  if (project?.publicStatus !== "published") return;

  const publishedVersion = await env.DB.prepare(
    "SELECT value FROM published_settings WHERE project_id=? AND key='shareVersion' LIMIT 1",
  )
    .bind(projectId)
    .first<{ value: string }>();
  const version = String(publishedVersion?.value || "").trim();
  if (!/^\d{1,20}$/.test(version)) return;

  const destination = `projects/${projectId}/share/cards/${version}`;
  if (await env.BUCKET.head(destination)) return;

  const source = await env.BUCKET.get(`projects/${projectId}/share/card`);
  if (!source) {
    throw new Error(
      "Current published share card missing hai; safe replacement blocked",
    );
  }

  await env.BUCKET.put(destination, source.body, {
    httpMetadata: {
      contentType:
        source.httpMetadata?.contentType || "application/octet-stream",
    },
    customMetadata: {
      source: "rekixo-publish-snapshot",
      version,
    },
  });
}

export async function promotePublishedAssets(
  projectId: string,
  publishVersion: number,
) {
  const canonicalMasterplan = canonicalAssetKey(projectId, "masterplan");
  const publishedMasterplan = publishedAssetKey(
    projectId,
    publishVersion,
    "masterplan",
  );
  const masterplanSaved = await copyR2Object(
    canonicalMasterplan,
    publishedMasterplan,
    true,
  );
  if (!masterplanSaved)
    throw new Error("Published masterplan source missing hai");

  const publicMasterplan = canonicalAssetKey(projectId, "masterplanPublic");
  const publishedPublic = publishedAssetKey(
    projectId,
    publishVersion,
    "masterplanPublic",
  );
  const publicSaved = await copyR2Object(
    publicMasterplan,
    publishedPublic,
    true,
  );
  if (!publicSaved) {
    await copyR2Object(canonicalMasterplan, publishedPublic, true);
  }

  await copyR2Object(
    canonicalAssetKey(projectId, "logo"),
    publishedAssetKey(projectId, publishVersion, "logo"),
    true,
  );
}

export function finalizeInactivePlotInventoryStatements(projectId: string) {
  return [
    // Explicitly cleared details have no business data left to preserve. Rows
    // with any saved value remain protected by the composite foreign key, so a
    // concurrent edit cannot silently disappear during the publish transaction.
    env.DB.prepare(
      `DELETE FROM plot_admin_details
       WHERE project_id=?
         AND COALESCE(TRIM(owner_name),'')=''
         AND booking_amount_paise IS NULL
         AND COALESCE(TRIM(broker_name),'')=''
         AND plot_id IN (
           SELECT id FROM plots WHERE project_id=? AND inventory_active=0
         )`,
    ).bind(projectId, projectId),
    env.DB.prepare(
      `UPDATE geo_features
       SET linked_plot_id=NULL
       WHERE project_id=?
         AND linked_plot_id IN (
           SELECT id FROM plots
           WHERE project_id=? AND inventory_active=0
         )`,
    ).bind(projectId, projectId),
    env.DB.prepare(
      `DELETE FROM plot_edge_measurements
       WHERE project_id=?
         AND plot_id IN (
           SELECT id FROM plots
           WHERE project_id=? AND inventory_active=0
         )`,
    ).bind(projectId, projectId),
    env.DB.prepare(
      `DELETE FROM plot_pricing
       WHERE project_id=?
         AND plot_id IN (
           SELECT id FROM plots
           WHERE project_id=? AND inventory_active=0
         )`,
    ).bind(projectId, projectId),
    env.DB.prepare(
      "DELETE FROM plots WHERE project_id=? AND inventory_active=0",
    ).bind(projectId),
  ];
}

export function capturePublishedSnapshotStatements(
  projectId: string,
  publishVersion: number,
  now: string,
) {
  const placeholders = PUBLISHED_SETTING_KEYS.map(() => "?").join(",");

  return [
    env.DB.prepare(
      "DELETE FROM published_plot_edge_measurements WHERE project_id=?",
    ).bind(projectId),
    env.DB.prepare("DELETE FROM published_plots WHERE project_id=?").bind(
      projectId,
    ),
    env.DB.prepare("DELETE FROM published_settings WHERE project_id=?").bind(
      projectId,
    ),
    env.DB.prepare("DELETE FROM project_public_snapshots WHERE project_id=?").bind(
      projectId,
    ),
    env.DB.prepare(
      `INSERT INTO published_plots (
        project_id,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,
        dimension_unit,front_edge_index,depth_edge_index,back_edge_index,
        depth2_edge_index,front_label,depth_label,back_label,depth2_label,
        side_dimensions,edge_semantics,polygon,status,featured,updated_at
      )
      SELECT
        project_id,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,
        dimension_unit,front_edge_index,depth_edge_index,back_edge_index,
        depth2_edge_index,front_label,depth_label,back_label,depth2_label,
        side_dimensions,edge_semantics,polygon,status,featured,updated_at
      FROM plots WHERE project_id=? AND inventory_active=1`,
    ).bind(projectId),
    env.DB.prepare(
      `INSERT INTO published_plot_edge_measurements (
        project_id,plot_id,role,segment_index,edge_index,point_count,length,unit,
        raw_label,road_frontage,road_access
      )
      SELECT
        m.project_id,m.plot_id,m.role,m.segment_index,m.edge_index,m.point_count,
        m.length,m.unit,m.raw_label,m.road_frontage,m.road_access
      FROM plot_edge_measurements m
      WHERE m.project_id=?
        AND EXISTS (
          SELECT 1 FROM plots p
          WHERE p.project_id=m.project_id
            AND p.id=m.plot_id
            AND p.inventory_active=1
        )`,
    ).bind(projectId),
    env.DB.prepare(
      `INSERT INTO published_settings (project_id,key,value)
       SELECT project_id,key,value
       FROM settings
       WHERE project_id=? AND key IN (${placeholders})`,
    ).bind(projectId, ...PUBLISHED_SETTING_KEYS),
    env.DB.prepare(
      `INSERT INTO project_public_snapshots (
        project_id,publish_version,project_name,engine_project_id,engine_slug,
        engine_link_status,engine_public_enabled,engine_public_url,created_at
      )
      SELECT
        p.id,?,p.name,l.engine_project_id,l.engine_slug,l.status,
        COALESCE(l.public_enabled,0),l.public_url,?
      FROM projects p
      LEFT JOIN project_3d_links l ON l.platform_project_id=p.id
      WHERE p.id=? AND p.status='active'`,
    ).bind(publishVersion, now, projectId),
  ];
}
