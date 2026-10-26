import { env } from "cloudflare:workers";
import { requireSuperAdmin, sameOrigin } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { activeProjectDomain } from "@/modules/domains";
import { currentProjectLinks } from "@/modules/projects";
import { GLOBAL_SHARE_BRAND, SHARE_TEMPLATE } from "@/modules/sharing";
import { freezeCurrentPublishedShareCard } from "@/modules/public-publish-snapshot";

const denied = () =>
  Response.json({ error: "Super Admin access required" }, { status: 403 });
const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PUBLIC_SHARE_IMAGE_BYTES = 550 * 1024;

const SHARE_KEYS = [
  "projectName",
  "brandName",
  "location",
  "address",
  "logoName",
  "logoVersion",
  "shareTitle",
  "shareDescription",
  "shareImage",
  "shareVersion",
  "shareTemplate",
] as const;

async function ensureProject(projectId: string) {
  return env.DB.prepare(
    "SELECT id,name,slug,public_status AS publicStatus,public_host AS publicHost,admin_host AS adminHost,status FROM projects WHERE id=? AND status!='deleted' LIMIT 1",
  )
    .bind(projectId)
    .first<{
      id: string;
      name: string;
      slug: string;
      publicStatus: string;
      publicHost: string | null;
      adminHost: string | null;
      status: string;
    }>();
}

async function readSettings(projectId: string) {
  const placeholders = SHARE_KEYS.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    "SELECT key,value FROM settings WHERE project_id=? AND key IN (" +
      placeholders +
      ")",
  )
    .bind(projectId, ...SHARE_KEYS)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(
    (rows.results || []).map((row) => [row.key, row.value]),
  );
}

async function writeSetting(
  projectId: string,
  key: string,
  value: string,
  now: string,
) {
  await env.DB.prepare(
    "INSERT INTO settings (project_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  )
    .bind(projectId, key, value, now)
    .run();
}

function validateDetails(title: string, description: string) {
  if (title.length < 3 || title.length > 120)
    throw new Error("Share title 3-120 chars me rakhein");
  if (description.length < 10 || description.length > 280)
    throw new Error("Share description 10-280 chars me rakhein");
}

async function detectShareImageMime(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

  if (isJpeg) return "image/jpeg";
  if (isPng) return "image/png";
  if (isWebp) return "image/webp";
  return "";
}

async function shareState(projectId: string) {
  const project = await ensureProject(projectId);
  if (!project) return null;

  const settings = await readSettings(projectId);
  const [primaryDomain, primaryAdminDomain] = await Promise.all([
    activeProjectDomain(projectId, "public"),
    activeProjectDomain(projectId, "admin"),
  ]);
  const links = currentProjectLinks(
    project.slug,
    primaryDomain || project.publicHost,
    primaryAdminDomain || project.adminHost,
  );

  const shareVersion = settings.shareVersion || "1";
  const shareTitle = settings.shareTitle || settings.projectName || project.name;
  const shareDescription =
    settings.shareDescription ||
    [settings.brandName, settings.address || settings.location]
      .filter(Boolean)
      .join(" | ") ||
    `${shareTitle} interactive visualization.`;
  const cardUrl = settings.shareImage || "";
  const logoUrl = settings.logoName
    ? `/api/project-asset/logo?projectId=${encodeURIComponent(project.id)}&v=${encodeURIComponent(settings.logoVersion || settings.logoName)}`
    : "";

  const publishedSnapshot = await env.DB.prepare(
    `SELECT
       s.publish_version AS snapshotVersion,
       p.publish_version AS currentVersion,
       MAX(CASE WHEN ps.key='shareImage' THEN ps.value END) AS shareImage,
       MAX(CASE WHEN ps.key='shareVersion' THEN ps.value END) AS shareVersion
     FROM projects p
     LEFT JOIN project_public_snapshots s ON s.project_id=p.id
     LEFT JOIN published_settings ps ON ps.project_id=p.id
       AND ps.key IN ('shareImage','shareVersion')
     WHERE p.id=?
     GROUP BY p.id,s.publish_version,p.publish_version`,
  )
    .bind(project.id)
    .first<{
      snapshotVersion: number | null;
      currentVersion: number | null;
      shareImage: string | null;
      shareVersion: string | null;
    }>();

  // Treat publication as ready only when the immutable snapshot points at the
  // current publish version and contains a complete share-image version.
  // Save operations intentionally update draft/live settings only; Publish Update
  // is the sole transition that makes a new social preview public.
  const publishedShareVersion = String(publishedSnapshot?.shareVersion || "").trim();
  const publishedShareImageValue = String(publishedSnapshot?.shareImage || "").trim();
  const publishedShareImage = Boolean(publishedShareImageValue);
  const publishedSnapshotReady =
    project.publicStatus === "published" &&
    publishedSnapshot?.snapshotVersion != null &&
    publishedSnapshot?.currentVersion != null &&
    Number(publishedSnapshot.snapshotVersion) === Number(publishedSnapshot.currentVersion) &&
    publishedShareImage &&
    publishedShareVersion === String(publishedSnapshot?.shareVersion || "").trim() &&
    /^\d{1,20}$/.test(publishedShareVersion) &&
    // Copy only the current published version, never an un-published draft.
    publishedShareVersion === shareVersion &&
    publishedShareImageValue === String(settings.shareImage || "").trim();

  const linkVersion = publishedSnapshotReady ? publishedShareVersion : shareVersion;
  const shareUrl = links.publicUrl
    ? `${links.publicUrl}${links.publicUrl.includes("?") ? "&" : "?"}share=${encodeURIComponent(linkVersion)}`
    : "";

  return {
    projectId: project.id,
    projectName: project.name,
    publicStatus: project.publicStatus,
    publishedShareVersion,
    publishedShareImage,
    publishedSnapshotReady,
    shareTitle,
    shareDescription,
    shareVersion,
    shareTemplate: settings.shareTemplate || SHARE_TEMPLATE,
    logoUrl,
    cardUrl,
    shareUrl,
    publicUrl: links.publicUrl,
    adminUrl: links.adminUrl,
  };
}

export async function GET(request: Request) {
  const actor = await requireSuperAdmin();
  if (!actor) return denied();
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  if (!projectId)
    return Response.json({ error: "Project required" }, { status: 400 });
  const state = await shareState(projectId);
  if (!state)
    return Response.json({ error: "Project nahi mila" }, { status: 404 });
  return Response.json(state, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireSuperAdmin();
  if (!actor) return denied();
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });

  const contentType = request.headers.get("content-type") || "";
  const now = new Date().toISOString();

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const projectId = String(form.get("projectId") || "");
    const kind = String(form.get("kind") || "");
    const file = form.get("file");
    const sourceFile = form.get("sourceFile");
    const shareTitle = String(form.get("shareTitle") || "").trim();
    const shareDescription = String(form.get("shareDescription") || "").trim();
    const shareTemplate = String(form.get("shareTemplate") || SHARE_TEMPLATE);

    if (!(await ensureProject(projectId)))
      return Response.json({ error: "Project nahi mila" }, { status: 404 });
    if (kind !== "card" || !(file instanceof File))
      return Response.json(
        { error: "Valid share card file required" },
        { status: 400 },
      );
    if (shareTemplate !== SHARE_TEMPLATE)
      return Response.json({ error: "Share template invalid hai" }, { status: 400 });
    try {
      validateDetails(shareTitle, shareDescription);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Share details invalid hain" },
        { status: 400 },
      );
    }
    const detectedMime = await detectShareImageMime(file);
    if (
      !detectedMime ||
      file.size < 1 ||
      file.size > MAX_PUBLIC_SHARE_IMAGE_BYTES
    )
      return Response.json(
        {
          error:
            "Branded WhatsApp share image JPG, PNG ya WebP me aur 550 KB se chhoti honi chahiye",
        },
        { status: 400 },
      );
    if (!(sourceFile instanceof File))
      return Response.json(
        { error: "Original share image source required" },
        { status: 400 },
      );
    const sourceDetectedMime = await detectShareImageMime(sourceFile);
    if (
      !sourceDetectedMime ||
      sourceFile.size < 1 ||
      sourceFile.size > MAX_SOURCE_IMAGE_BYTES
    )
      return Response.json(
        { error: "Original share image JPG, PNG ya WebP me aur 8 MB se chhoti honi chahiye" },
        { status: 400 },
      );

    // Existing published social previews stay byte-stable until Publish Update.
    // This mainly backfills projects that predate versioned share-card snapshots.
    try {
      await freezeCurrentPublishedShareCard(projectId);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Published share card preserve nahi hua",
        },
        { status: 409 },
      );
    }

    const version = String(Date.now());
    const [bytes, sourceBytes] = await Promise.all([
      file.arrayBuffer(),
      sourceFile.arrayBuffer(),
    ]);
    await Promise.all([
      env.BUCKET.put(`projects/${projectId}/share/card`, bytes, {
        httpMetadata: { contentType: detectedMime },
        customMetadata: {
          source: "ar3d-branded-derivative",
          brandId: GLOBAL_SHARE_BRAND.id,
          brandVersion: GLOBAL_SHARE_BRAND.version,
          template: SHARE_TEMPLATE,
          version,
        },
      }),
      env.BUCKET.put(`projects/${projectId}/share/cards/${version}`, bytes, {
        httpMetadata: { contentType: detectedMime },
        customMetadata: {
          source: "ar3d-branded-derivative",
          brandId: GLOBAL_SHARE_BRAND.id,
          brandVersion: GLOBAL_SHARE_BRAND.version,
          template: SHARE_TEMPLATE,
          version,
        },
      }),
      env.BUCKET.put(`projects/${projectId}/share/source`, sourceBytes, {
        httpMetadata: { contentType: sourceDetectedMime },
        customMetadata: {
          source: "original-upload",
          version,
        },
      }),
      env.BUCKET.put(`projects/${projectId}/share/sources/${version}`, sourceBytes, {
        httpMetadata: { contentType: sourceDetectedMime },
        customMetadata: {
          source: "original-upload",
          version,
        },
      }),
    ]);
    const shareImage = `/api/project-asset/shareCard?projectId=${encodeURIComponent(projectId)}&v=${encodeURIComponent(version)}`;
    await Promise.all([
      writeSetting(projectId, "shareVersion", version, now),
      writeSetting(projectId, "shareImage", shareImage, now),
      writeSetting(projectId, "shareTitle", shareTitle, now),
      writeSetting(projectId, "shareDescription", shareDescription, now),
      writeSetting(projectId, "shareTemplate", SHARE_TEMPLATE, now),
    ]);
    await writeAudit(actor, "project.share_card_saved", projectId, null, {
      version,
      size: file.size,
      sourceSize: sourceFile.size,
      template: SHARE_TEMPLATE,
      source: "ar3d-branded-derivative",
      sourceMime: sourceDetectedMime,
      mime: detectedMime,
      brandId: GLOBAL_SHARE_BRAND.id,
      brandVersion: GLOBAL_SHARE_BRAND.version,
    });
    const state = await shareState(projectId);
    return Response.json({ ok: true, ...state });
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
    shareTitle?: string;
    shareDescription?: string;
  };
  const projectId = String(body.projectId || "");
  const shareTitle = String(body.shareTitle || "").trim();
  const shareDescription = String(body.shareDescription || "").trim();
  if (!projectId)
    return Response.json({ error: "Project required" }, { status: 400 });
  if (!(await ensureProject(projectId)))
    return Response.json({ error: "Project nahi mila" }, { status: 404 });
  try {
    validateDetails(shareTitle, shareDescription);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Share details invalid hain" },
      { status: 400 },
    );
  }

  // Any metadata edit gets a fresh share URL so WhatsApp/social crawlers do not
  // keep serving an older title/description from their URL cache.
  const version = String(Date.now());
  await Promise.all([
    writeSetting(projectId, "shareTitle", shareTitle, now),
    writeSetting(projectId, "shareDescription", shareDescription, now),
    writeSetting(projectId, "shareVersion", version, now),
    writeSetting(projectId, "shareTemplate", SHARE_TEMPLATE, now),
  ]);
  await writeAudit(actor, "project.share_details_saved", projectId, null, {
    version,
    template: SHARE_TEMPLATE,
  });
  const state = await shareState(projectId);
  return Response.json({ ok: true, ...state });
}
