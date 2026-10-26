import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { generatePublishedProjectMetadata } from "@/app/project-share-metadata";
import { panelMode } from "@/modules/auth";
import { isPlatformAccessHost, projectBySlug } from "@/modules/public-project";
import { publicSiteEnabled } from "@/modules/public-site-access";

export const dynamic = "force-dynamic";

const LEGACY_PROJECT = "tiyansh-prime-square";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return generatePublishedProjectMetadata(slug);
}

export default async function SharedProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (panelMode() === "super") notFound();

  const { slug } = await params;
  const host = (await headers()).get("host") || "";
  if (!isPlatformAccessHost(host)) notFound();

  const project = await projectBySlug(slug);
  if (!project) notFound();

  if (!(await publicSiteEnabled(project.id))) {
    return (
      <main
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#050914",
          color: "#f7f9ff",
        }}
      >
        <section
          style={{
            width: "min(560px, 100%)",
            padding: 32,
            border: "1px solid #26344b",
            borderRadius: 18,
            background: "#0b1424",
            textAlign: "center",
          }}
        >
          <h1>Project Temporarily Unavailable</h1>
          <p>This project is temporarily unavailable. Please try again later.</p>
        </section>
      </main>
    );
  }

  const published = await env.DB.prepare(
    `SELECT
       p.publish_version AS publishVersion,
       s.publish_version AS snapshotVersion,
       (SELECT value FROM published_settings WHERE project_id=p.id AND key='publicDataRevision' LIMIT 1) AS dataRevision
     FROM projects p
     LEFT JOIN project_public_snapshots s ON s.project_id=p.id
     WHERE p.id=?
     LIMIT 1`,
  )
    .bind(project.id)
    .first<{ publishVersion: number; snapshotVersion: number | null; dataRevision: string | null }>();

  const snapshotReady =
    published?.snapshotVersion != null &&
    Number(published.snapshotVersion) === Number(published.publishVersion);
  if (!snapshotReady && project.id !== LEGACY_PROJECT) {
    return (
      <main
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#050914",
          color: "#f7f9ff",
        }}
      >
        <section
          style={{
            width: "min(560px, 100%)",
            padding: 32,
            border: "1px solid #26344b",
            borderRadius: 18,
            background: "#0b1424",
            textAlign: "center",
          }}
        >
          <h1>Project Temporarily Unavailable</h1>
          <p>This project is temporarily unavailable. Please try again later.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={{ position: "fixed", inset: 0, background: "#050914" }}>
      <iframe
        title={`${project.name} website`}
        src={`/__rekixo/project/?projectSlug=${encodeURIComponent(project.slug)}&pv=${encodeURIComponent(String(published?.publishVersion || 0))}&v=69${published?.dataRevision ? `&dataRevision=${encodeURIComponent(published.dataRevision)}` : ""}`}
        loading="eager"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
    </main>
  );
}
