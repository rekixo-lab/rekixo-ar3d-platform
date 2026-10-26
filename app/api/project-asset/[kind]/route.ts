import { env } from "cloudflare:workers";
import { getAdminSession } from "@/modules/auth";
import { publicProjectId } from "@/modules/projects";
import {
  compatiblePublishedMasterplanOriginalKey,
  currentMasterplanOriginalKey,
  publishedAssetKey,
} from "@/modules/public-publish-snapshot";
import {
  publicSiteEnabled,
  publicSiteUnavailableResponse,
} from "@/modules/public-site-access";

const PUBLIC_KINDS = new Set(["masterplan", "logo", "shareCard"]);
const ADMIN_KINDS = new Set(["sourcePdf"]);
const SUPER_ADMIN_ONLY = new Set([
  "sourceCad",
  "cadGeometry",
  "plotSheet",
  "masterplanOriginal",
]);

async function activeProjectId(projectId: string) {
  if (!projectId) return null;
  const row = await env.DB.prepare(
    "SELECT id FROM projects WHERE id=? AND status='active' LIMIT 1",
  )
    .bind(projectId)
    .first<{ id: string }>();
  return row?.id || null;
}

type AssetAccess = {
  projectId: string;
  mode: "admin" | "public";
  session: Awaited<ReturnType<typeof getAdminSession>>;
};

async function authorizedAssetAccess(request: Request, kind: string) {
  const session = await getAdminSession();
  const url = new URL(request.url);
  const requested = url.searchParams.get("projectId");
  const variant = url.searchParams.get("variant") || "";
  const previewRequest = url.searchParams.get("preview") === "1";
  const explicitPublic =
    PUBLIC_KINDS.has(kind) &&
    (url.searchParams.get("public") === "1" ||
      variant === "public" ||
      variant === "public-canonical" ||
      variant === "original");

  // Mapper preview requests are authenticated admin requests even when they ask
  // for optimized public masterplan bytes. Resolve preview before public routing
  // so a draft project's authenticated preview never requires published state.
  if (previewRequest && session?.role === "super_admin") {
    const projectId = requested ? await activeProjectId(requested) : null;
    return projectId
      ? ({ projectId, mode: "admin", session } satisfies AssetAccess)
      : null;
  }
  if (previewRequest && session?.role === "client_admin") {
    if (requested && requested !== session.projectId) return null;
    const projectId = await activeProjectId(session.projectId);
    return projectId
      ? ({ projectId, mode: "admin", session } satisfies AssetAccess)
      : null;
  }

  // Resolve the public project independently of any admin cookie. A browser may
  // legitimately be logged into Client A while viewing Client B's published site.
  // Public resolution is published-only, so this never grants draft/private access.
  const publicId = PUBLIC_KINDS.has(kind)
    ? await publicProjectId(request)
    : null;

  if (explicitPublic) {
    return publicId
      ? ({ projectId: publicId, mode: "public", session } satisfies AssetAccess)
      : null;
  }

  // Super Admin canonical requests still require an explicit project.
  if (session?.role === "super_admin") {
    const projectId = requested ? await activeProjectId(requested) : null;
    return projectId
      ? ({ projectId, mode: "admin", session } satisfies AssetAccess)
      : null;
  }

  // Client admins stay tenant-scoped for private/canonical assets. If the request
  // independently resolves to another published project, serve only its public
  // contract instead of letting the unrelated cookie turn a public request into 404.
  if (session?.role === "client_admin") {
    if (
      publicId &&
      publicId !== session.projectId &&
      (!requested || requested === publicId)
    ) {
      return {
        projectId: publicId,
        mode: "public",
        session,
      } satisfies AssetAccess;
    }
    if (requested && requested !== session.projectId) return null;
    const projectId = await activeProjectId(session.projectId);
    return projectId
      ? ({ projectId, mode: "admin", session } satisfies AssetAccess)
      : null;
  }

  return publicId
    ? ({ projectId: publicId, mode: "public", session } satisfies AssetAccess)
    : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (![...PUBLIC_KINDS, ...ADMIN_KINDS, ...SUPER_ADMIN_ONLY].includes(kind))
    return new Response("Not found", { status: 404 });

  const access = await authorizedAssetAccess(request, kind);
  if (!access) return new Response("Not found", { status: 404 });
  const { projectId, mode, session } = access;

  if (mode === "public" && !(await publicSiteEnabled(projectId))) {
    return publicSiteUnavailableResponse();
  }

  if (SUPER_ADMIN_ONLY.has(kind) && session?.role !== "super_admin")
    return new Response("Not found", { status: 404 });
  if (ADMIN_KINDS.has(kind) && mode !== "admin")
    return new Response("Not found", { status: 404 });

  const requestUrl = new URL(request.url);
  const previewRequest = requestUrl.searchParams.get("preview") === "1";
  const authorizedPreview = previewRequest && mode === "admin";
  const variant = requestUrl.searchParams.get("variant") || "";
  const publicVariant =
    variant === "public" || variant === "public-canonical" || variant === "original";
  const wantsPublicMasterplan =
    kind === "masterplan" && variant === "public";
  const wantsOriginalMasterplan =
    kind === "masterplan" && variant === "original";

  // Mapper/admin requests keep reading the editable canonical objects. Customer
  // requests read immutable bytes captured for the current publishVersion.
  const shouldServePublished =
    (kind === "masterplan" || kind === "logo") &&
    mode === "public" &&
    !authorizedPreview;

  const objectKind = wantsPublicMasterplan
    ? "masterplanPublic"
    : kind === "masterplan"
      ? "masterplan"
      : kind;

  let publishVersion: number | null = null;
  if (shouldServePublished) {
    const published = await env.DB.prepare(
      "SELECT public_status AS publicStatus,publish_version AS publishVersion FROM projects WHERE id=? AND status='active' LIMIT 1",
    )
      .bind(projectId)
      .first<{ publicStatus: string; publishVersion: number }>();
    if (published?.publicStatus === "published") {
      publishVersion = Number(published.publishVersion ?? 0);
    }
  }

  const requestedAssetVersion = requestUrl.searchParams.get("v") || "";
  const validShareVersion = /^\d{1,20}$/.test(requestedAssetVersion)
    ? requestedAssetVersion
    : "";

  let objectKey =
    kind === "shareCard"
      ? validShareVersion
        ? `projects/${projectId}/share/cards/${validShareVersion}`
        : `projects/${projectId}/share/card`
      : `projects/${projectId}/mapper/${objectKind}`;

  if (publishVersion !== null && (objectKind === "masterplan" || objectKind === "masterplanPublic" || objectKind === "logo")) {
    objectKey = publishedAssetKey(
      projectId,
      publishVersion,
      objectKind as "masterplan" | "masterplanPublic" | "logo",
    );
  }

  // New large-masterplan uploads keep the original at a versioned R2 key so a
  // failed replacement can never destroy the previous source. Old projects still
  // resolve the historical stable key with zero migration.
  if (kind === "masterplanOriginal") {
    const pointer = await env.DB.prepare(
      "SELECT value FROM settings WHERE project_id=? AND key='masterplanOriginalObjectToken' LIMIT 1",
    )
      .bind(projectId)
      .first<{ value: string }>();
    const token = String(pointer?.value || "");
    if (/^[a-zA-Z0-9_-]{12,80}$/.test(token)) {
      objectKey = `projects/${projectId}/mapper/masterplanOriginal/${token}`;
    }
  }

  if (wantsOriginalMasterplan && shouldServePublished) {
    if (publishVersion === null) return new Response("Not found", { status: 404 });
    // A page can remain open while another version is published. Do not put new
    // image pixels underneath that page's older plot polygons or cache them at an
    // old immutable URL. Its already loaded preview remains usable.
    if (requestedAssetVersion && requestedAssetVersion !== String(publishVersion)) {
      return new Response("Published masterplan version changed", {
        status: 409,
        headers: { "cache-control": "no-store" },
      });
    }
    objectKey = publishedAssetKey(projectId, publishVersion, "masterplanOriginal");
  } else if (wantsOriginalMasterplan && mode === "admin" && session?.role === "super_admin") {
    const canonical = await env.BUCKET.head(`projects/${projectId}/mapper/masterplan`);
    const originalKey = await currentMasterplanOriginalKey(projectId, canonical);
    if (originalKey) objectKey = originalKey;
  }

  let object = await env.BUCKET.get(objectKey);
  let servedPublishedSnapshot = Boolean(object && publishVersion !== null);
  let servedMasterplanSource =
    kind === "masterplan"
      ? wantsPublicMasterplan
        ? "published-public-optimized"
        : "published-canonical"
      : objectKind;

  if (wantsOriginalMasterplan) {
    servedMasterplanSource = shouldServePublished ? "published-original" : "canonical-original";
    if (!object && shouldServePublished && publishVersion !== null) {
      const compatibleKey = await compatiblePublishedMasterplanOriginalKey(projectId, publishVersion);
      if (compatibleKey) {
        object = await env.BUCKET.get(compatibleKey);
        servedPublishedSnapshot = false;
        servedMasterplanSource = "published-original-compatible";
      }
    }
    if (!object || (mode === "admin" && objectKey === `projects/${projectId}/mapper/masterplan`)) {
      object = await env.BUCKET.get(
        shouldServePublished && publishVersion !== null
          ? publishedAssetKey(projectId, publishVersion, "masterplan")
          : `projects/${projectId}/mapper/masterplan`,
      );
      servedPublishedSnapshot = Boolean(object && shouldServePublished);
      servedMasterplanSource = shouldServePublished
        ? "published-canonical-fallback"
        : "canonical-fallback";
    }
  }

  if (!wantsOriginalMasterplan) {
    // Versioned share-card URLs are the public immutable contract. Older projects
    // may not have the versioned object yet; canonical fallback is safe because
    // share-image replacement freezes the currently published version first.
    if (!object && kind === "shareCard" && validShareVersion) {
      object = await env.BUCKET.get(`projects/${projectId}/share/card`);
    }

    if (!object && publishVersion !== null && wantsPublicMasterplan) {
      object = await env.BUCKET.get(
        publishedAssetKey(projectId, publishVersion, "masterplan"),
      );
      if (object) {
        servedPublishedSnapshot = true;
        servedMasterplanSource = "published-canonical-fallback";
      }
    }

    // Backward compatibility for projects published before versioned R2 snapshots
    // existed. The next asset edit freezes this canonical object before replacing it.
    if (!object && shouldServePublished) {
      servedPublishedSnapshot = false;
      const fallbackKind = wantsPublicMasterplan ? "masterplanPublic" : objectKind;
      object = await env.BUCKET.get(
        `projects/${projectId}/mapper/${fallbackKind}`,
      );
      if (!object && wantsPublicMasterplan) {
        object = await env.BUCKET.get(`projects/${projectId}/mapper/masterplan`);
        servedMasterplanSource = "legacy-canonical-fallback";
      } else if (kind === "masterplan") {
        servedMasterplanSource = wantsPublicMasterplan
          ? "legacy-public-fallback"
          : "legacy-canonical-fallback";
      }
    } else if (!object && wantsPublicMasterplan) {
      object = await env.BUCKET.get(`projects/${projectId}/mapper/masterplan`);
      servedMasterplanSource = "canonical-fallback";
    } else if (!object && kind === "masterplan") {
      object = await env.BUCKET.get(`projects/${projectId}/mapper/masterplanPublic`);
      servedMasterplanSource = "public-fallback";
    } else if (
      !object &&
      kind === "masterplanOriginal" &&
      objectKey !== `projects/${projectId}/mapper/masterplanOriginal`
    ) {
      object = await env.BUCKET.get(`projects/${projectId}/mapper/masterplanOriginal`);
    }
  }
  if (!object) return new Response("Not found", { status: 404 });

  // The original URL is also used for older projects. Its byte source must be
  // observable without downloading a possibly 100 MB image. This read-only
  // probe shares the EXACT tenant/publish resolution above and never exposes
  // R2 keys or editable originals to public callers.
  const sourceIsOriginal =
    wantsOriginalMasterplan &&
    (servedMasterplanSource === "published-original" ||
      servedMasterplanSource === "published-original-compatible" ||
      servedMasterplanSource === "canonical-original");
  if (kind === "masterplan" && wantsOriginalMasterplan &&
      requestUrl.searchParams.get("inspect") === "1") {
    return Response.json({
      source: servedMasterplanSource,
      original: sourceIsOriginal,
      bytes: Number(object.size || 0),
      contentType: object.httpMetadata?.contentType || "application/octet-stream",
      version: publishVersion,
    }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }

  // Published versioned masterplan/logo responses are immutable by design. The
  // public-site kill switch is checked above on every origin request, but bytes
  // already stored in a browser/CDN immutable cache cannot be recalled. Runtime
  // shells revalidate and gallery bytes are no-store so revocation-sensitive
  // surfaces still return to origin promptly.
  const versionedRequest = requestUrl.searchParams.has("v");
  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType || "application/octet-stream",
    "cache-control":
      mode === "admin"
        ? "no-store"
        : kind === "masterplan" && publicVariant && versionedRequest &&
            (wantsOriginalMasterplan
              ? servedMasterplanSource === "published-original" && servedPublishedSnapshot
              : servedPublishedSnapshot)
          ? "public,max-age=31536000,immutable"
          : kind === "masterplan"
            ? "public,max-age=0,must-revalidate"
          : kind === "shareCard"
            ? versionedRequest
              ? "public,max-age=31536000,immutable"
              : "public,max-age=0,must-revalidate"
            : kind === "logo"
              ? "public,max-age=31536000,immutable"
              : "private,no-store",
    "x-content-type-options": "nosniff",
  });
  headers.set("x-rekixo-project", projectId);
  headers.set("x-rekixo-access-mode", mode);
  if (shouldServePublished) {
    headers.set(
      "x-rekixo-publish-asset",
      servedPublishedSnapshot ? "snapshot" : "legacy-fallback",
    );
  }
  if (kind === "masterplan") {
    headers.set("x-rekixo-masterplan-source", servedMasterplanSource);
    if (wantsOriginalMasterplan)
      headers.set("x-rekixo-original-fidelity", sourceIsOriginal ? "original" : "optimized-fallback");
  }
  if (kind === "shareCard") {
    // OG images should be directly fetchable by unauthenticated social crawlers.
    headers.set("content-disposition", "inline");
    headers.set("content-length", String(object.size));
    headers.set("cross-origin-resource-policy", "cross-origin");
    headers.set("access-control-allow-origin", "*");
  }
  if (kind === "sourceCad" || kind === "plotSheet" || kind === "masterplanOriginal")
    headers.set("content-disposition", "attachment");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
