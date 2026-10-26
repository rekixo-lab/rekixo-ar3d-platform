import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { projectBySlug } from "@/modules/public-project";
import { publicSiteEnabled } from "@/modules/public-site-access";

// Shared public metadata for /projects/[slug] and standalone custom-domain /.
const LEGACY_PROJECT = "tiyansh-prime-square";

type MetaSettings = Record<string, string>;

function unavailableMeta(project: Awaited<ReturnType<typeof projectBySlug>>) {
  if (!project) return null;
  return {
    project,
    paused: true as const,
    title: "Project Temporarily Unavailable",
    description: "This project is temporarily unavailable. Please try again later.",
    imageUrl: "",
    logoUrl: "",
    hasShareImage: false,
    brandName: "Rekixo",
    origin: "",
  };
}

async function readProjectMeta(slug: string) {
  const project = await projectBySlug(slug);
  if (!project) return null;
  if (!(await publicSiteEnabled(project.id))) {
    return unavailableMeta(project);
  }

  const snapshot = await env.DB.prepare(
    `SELECT
       s.project_name AS projectName,
       s.publish_version AS publishVersion,
       p.publish_version AS currentPublishVersion
     FROM projects p
     LEFT JOIN project_public_snapshots s ON s.project_id=p.id
     WHERE p.id=?
     LIMIT 1`,
  )
    .bind(project.id)
    .first<{
      projectName: string | null;
      publishVersion: number | null;
      currentPublishVersion: number;
    }>();
  const snapshotReady =
    snapshot?.publishVersion != null &&
    Number(snapshot.publishVersion) === Number(snapshot.currentPublishVersion);

  if (!snapshotReady && project.id !== LEGACY_PROJECT) {
    return unavailableMeta(project);
  }

  const rows = snapshotReady
    ? await env.DB.prepare(
        "SELECT key,value FROM published_settings WHERE project_id=? AND key IN ('projectName','brandName','location','address','logoName','logoVersion','shareTitle','shareDescription','shareImage','shareVersion')",
      )
        .bind(project.id)
        .all<{ key: string; value: string }>()
    : await env.DB.prepare(
        "SELECT key,value FROM settings WHERE project_id=? AND key IN ('projectName','brandName','location','address','logoName','logoVersion','shareTitle','shareDescription','shareImage','shareVersion')",
      )
        .bind(project.id)
        .all<{ key: string; value: string }>();

  const settings: MetaSettings = Object.fromEntries(
    (rows.results || []).map((row) => [row.key, row.value]),
  );

  const publishedProjectName = snapshotReady ? snapshot?.projectName || project.name : project.name;
  const title =
    settings.shareTitle || settings.projectName || publishedProjectName || "Project";
  const description =
    settings.shareDescription ||
    [settings.brandName, settings.address || settings.location]
      .filter(Boolean)
      .join(" • ") ||
    `${title} interactive plot visualization.`;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "";
  const proto = requestHeaders.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : "";

  const logoPath = settings.logoName
    ? `/api/project-asset/logo?projectId=${encodeURIComponent(project.id)}&variant=public&v=${encodeURIComponent(settings.logoVersion || settings.logoName)}`
    : "";
  // Social crawlers should fetch the same immutable R2-backed public asset
  // contract used by the public asset API. Avoid routing OG images through a
  // second nested share-image handler; the direct asset endpoint
  // is already tenant-scoped and has versioned R2 + canonical fallback logic.
  const shareImagePath = settings.shareImage
    ? `/api/project-asset/shareCard?projectId=${encodeURIComponent(project.id)}&v=${encodeURIComponent(settings.shareVersion || "1")}&public=1`
    : "";
  const imagePath = shareImagePath || logoPath;
  const imageUrl =
    imagePath && origin ? new URL(imagePath, origin).toString() : imagePath || "";
  const logoUrl =
    logoPath && origin ? new URL(logoPath, origin).toString() : logoPath || "";

  return {
    project,
    paused: false as const,
    title,
    description,
    imageUrl,
    logoUrl,
    hasShareImage: Boolean(settings.shareImage),
    brandName: settings.brandName || "AR 3D Vision",
    origin,
  };
}

export async function generatePublishedProjectMetadata(slug: string): Promise<Metadata> {
  const meta = await readProjectMeta(slug);

  if (!meta) {
    return {
      title: "Project",
      description: "Interactive project and plot visualization.",
    };
  }

  const images = meta.imageUrl
    ? [{ url: meta.imageUrl, alt: meta.title }]
    : undefined;

  return {
    metadataBase: meta.origin ? new URL(meta.origin) : undefined,
    title: meta.title,
    description: meta.description,
    icons: meta.logoUrl
      ? { icon: meta.logoUrl, shortcut: meta.logoUrl }
      : undefined,
    openGraph: {
      type: "website",
      siteName: meta.brandName,
      title: meta.title,
      description: meta.description,
      images,
    },
    twitter: {
      card: meta.hasShareImage ? "summary_large_image" : "summary",
      title: meta.title,
      description: meta.description,
      images: meta.imageUrl ? [meta.imageUrl] : undefined,
    },
  };
}

