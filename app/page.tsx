import type { Metadata } from "next";
import { headers } from "next/headers";
import { generatePublishedProjectMetadata } from "./project-share-metadata";
import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { panelMode } from "@/modules/auth";
import { projectHostRole } from "@/modules/public-project";
import { publicSiteEnabled } from "@/modules/public-site-access";

export const dynamic = "force-dynamic";

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#050914",
        color: "#f7f9ff",
      }}
    >
      <section
        style={{
          maxWidth: 560,
          padding: 32,
          border: "1px solid #26344b",
          borderRadius: 18,
          background: "#0b1424",
          textAlign: "center",
        }}
      >
        <h1>{title}</h1>
        <p>{text}</p>
      </section>
    </main>
  );
}

// Project-specific Open Graph tags must live on the parent page, not its iframe.
export async function generateMetadata(): Promise<Metadata> {
  const generic: Metadata = {
    title: "AR 3D Vision Project",
    description: "Interactive project and plot visualization.",
  };
  if (panelMode() === "super") return generic;

  const host = (await headers()).get("host") || "";
  const target = await projectHostRole(host);
  if (target?.role !== "public" || !target.projectId) return generic;
  const project = await env.DB.prepare(
    "SELECT slug FROM projects WHERE id=? AND status='active' AND public_status='published' LIMIT 1",
  )
    .bind(target.projectId)
    .first<{ slug: string }>();
  return project?.slug
    ? generatePublishedProjectMetadata(project.slug)
    : generic;
}

export default async function Home() {
  if (panelMode() === "super") redirect("/admin");
  const host = (await headers()).get("host") || "";
  const target = await projectHostRole(host);

  if (target?.role === "admin" || target?.role === "admin_shared")
    redirect("/admin");
  if (target?.role === "unpublished")
    return (
      <Message
        title="Website is being prepared"
        text="Project अभी draft/review में है। Publish complete होने के बाद यही domain live website दिखाएगा।"
      />
    );
  if (!target)
    return (
      <Message
        title="Project domain not configured"
        text="इस domain को Rekixo Super Admin में सही client project से जोड़ें।"
      />
    );

  if (
    target.role === "public" &&
    target.projectId &&
    !(await publicSiteEnabled(target.projectId))
  )
    return (
      <Message
        title="Project Temporarily Unavailable"
        text="This project is temporarily unavailable. Please try again later."
      />
    );

  const published = target.projectId
    ? await env.DB.prepare("SELECT publish_version AS publishVersion FROM projects WHERE id=? LIMIT 1")
        .bind(target.projectId)
        .first<{ publishVersion: number }>()
    : null;

  return (
    <main style={{ position: "fixed", inset: 0, background: "#050914" }}>
      <iframe
        title="Client project website"
        src={`/project/index.html?projectId=${encodeURIComponent(target.projectId || "")}&pv=${encodeURIComponent(String(published?.publishVersion || 0))}&v=69`}
        loading="eager"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
    </main>
  );
}
