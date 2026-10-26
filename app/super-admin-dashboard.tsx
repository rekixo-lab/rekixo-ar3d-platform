"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ExternalLink,
  Globe2,
  LogOut,
  MapPinned,
  ContactRound,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  WalletCards,
} from "lucide-react";
import ClientAdminManager from "./client-admin-manager";
import GeoLabClone from "./geo-lab-clone";
import GeoMapper from "./geo-mapper";
import PlotMapper from "./plot-mapper";
import ProjectCustomerActionsManager from "./project-customer-actions-manager";
import ProjectDomainManager from "./project-domain-manager";
import ProjectPublishPanel from "./project-publish-panel";
import ProjectProfileManager from "./project-profile-manager";
import ProjectPublicAccessManager from "./project-public-access-manager";
import ProjectAssetsManager from "./project-assets-manager";
import ProjectShareManager from "./project-share-manager";
import ProjectStatusThemeManager from "./project-status-theme-manager";
import MotionSwap, { MotionToast } from "./motion-swap";
import SalesControls from "./sales-controls";
import ProjectAdminStudioManager from "./project-admin-studio-manager";
import ProjectPlotNoticeManager from "./project-plot-notice-manager";

type Project = {
  id: string;
  name: string;
  kind: string;
  status: string;
  adminCount: number;
};

type WorkspaceTab = "clients" | "profile" | "mapper" | "mapping-controls" | "geo" | "share" | "assets" | "accounts" | "studio";

export default function SuperAdminDashboard({
  user,
}: {
  user: { name: string; email: string };
}) {
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("clients");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 2800);
  }, []);

  useEffect(() => {
    if (tab === "clients") return;
    let live = true;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        section: "projects",
        limit: "50",
        offset: "0",
      });
      if (projectSearch.trim()) query.set("q", projectSearch.trim());
      fetch(`/api/admin/users?${query.toString()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => {
          if (!live) return;
          const list = (data.projects || []) as Project[];
          setProjects(list);
          setProjectId((current) =>
            current && list.some((project: Project) => project.id === current)
              ? current
              : list[0]?.id || "",
          );
        })
        .catch(() => notify("Projects load नहीं हुए"));
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [tab, notify, projectSearch]);

  const projectPicker = (
    <div className="super-project-picker">
      <label htmlFor="workspace-project">Client project</label>
      <input
        className="super-project-search"
        value={projectSearch}
        onChange={(event) => setProjectSearch(event.target.value)}
        placeholder="Search project name / slug"
        aria-label="Search client projects"
      />
      <select
        id="workspace-project"
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <option value="">Project चुनें</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} · {project.adminCount} admin
          </option>
        ))}
      </select>
      {projectId ? (
        <a
          className="mapper-preview-link"
          href={`/preview/${encodeURIComponent(projectId)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink /> Authenticated preview
        </a>
      ) : null}
    </div>
  );

  const title =
    tab === "clients"
      ? "Projects & Access"
      : tab === "profile"
        ? "Project Profile"
        : tab === "mapper"
          ? "Plot Mapper Engine"
          : tab === "mapping-controls"
            ? "Mapping Controls"
            : tab === "geo"
            ? "Geo Mapper"
              : tab === "accounts"
                ? "Sales & Accounts Controls"
              : tab === "studio"
                ? "Project Admin Studio"
              : tab === "share"
                ? "Share Preview Builder"
                : "Project Assets";
  const subtitle =
    tab === "clients"
      ? "Create projects, assign client access and manage domains."
      : tab === "profile"
        ? "One canonical contact profile plus project-wise customer actions — Super Admin controls what the public site exposes."
        : tab === "mapper"
          ? "Company masterplan से client website के clickable plots तैयार करें।"
          : tab === "mapping-controls"
            ? "Mapped plots ke Dimensions, Area, Facing/Road aur Front/Back/Depth sizes ko manually aur safely update karein."
            : tab === "geo"
            ? "Project boundaries, GPS control points aur GIS exchange data ko isolated Geo workspace me manage karein."
              : tab === "accounts"
                ? "Per-project financial access, roles and private ledger controls."
              : tab === "studio"
                ? "Per-project workflows, modules and custom fields without changing other builders."
              : tab === "share"
                ? "Har project ka branded WhatsApp / social link preview ek jagah se manage karein."
                : "Selected project ka recovery-ready working data, source assets aur published snapshot safely export karein.";

  return (
    <div className="super-shell">
      <aside className="super-sidebar">
        <div className="super-brand">
          <span>
            <ShieldCheck />
          </span>
          <div>
            <b>REKIXO</b>
            <small>SUPER ADMIN</small>
          </div>
        </div>

        <nav className="super-tabs">
          <button
            className={tab === "clients" ? "active" : ""}
            onClick={() => setTab("clients")}
          >
            <Users /> Clients
          </button>
          <button
            className={tab === "profile" ? "active" : ""}
            onClick={() => setTab("profile")}
          >
            <ContactRound /> Project Profile
          </button>
          <button
            className={tab === "mapper" ? "active" : ""}
            onClick={() => setTab("mapper")}
          >
            <MapPinned /> Plot Mapper
          </button>
          <button
            className={tab === "mapping-controls" ? "active" : ""}
            onClick={() => setTab("mapping-controls")}
          >
            <SlidersHorizontal /> Mapping Controls
          </button>
          <button
            className={tab === "geo" ? "active" : ""}
            onClick={() => setTab("geo")}
          >
            <Globe2 /> Geo Mapper
          </button>
          <button onClick={() => setTab("accounts")} className={tab === "accounts" ? "active" : ""}><WalletCards /> Sales &amp; Accounts</button>
          <button onClick={() => setTab("studio")} className={tab === "studio" ? "active" : ""}><SlidersHorizontal /> Admin Studio</button>
          <button
            className={tab === "share" ? "active" : ""}
            onClick={() => setTab("share")}
          >
            <Share2 /> Share Builder
          </button>
          <button
            className={tab === "assets" ? "active" : ""}
            onClick={() => setTab("assets")}
          >
            <Archive /> Project Assets
          </button>
        </nav>
      </aside>

      <section className="super-workspace">
        <header className="super-header">
          <div className="super-header-context">
            {tab === "clients" ? (
              <span className="super-top-label">REKIXO OPERATIONS</span>
            ) : (
              projectPicker
            )}
          </div>

          <div className="super-account">
            <div>
              <b>{user.name}</b>
              <small>{user.email}</small>
            </div>
            <a href="/api/admin/logout">
              <LogOut /> Sign out
            </a>
          </div>
        </header>

        <main className="super-content">
          <div className="super-title">
            <h1>{title}</h1>
            <span>{subtitle}</span>
          </div>

          <MotionSwap motionKey={`${tab}:${tab === "clients" ? "clients" : projectId || "none"}`}>
            <div className="super-motion-panel">
              {tab === "clients" ? (
                <>
                  <ClientAdminManager notify={notify} />
                  <ProjectDomainManager notify={notify} />
                </>
              ) : (
                <>
                  {projectId && tab !== "assets" && tab !== "mapping-controls" ? (
                    <ProjectPublicAccessManager
                      key={`public-access:${projectId}`}
                      projectId={projectId}
                      notify={notify}
                    />
                  ) : null}
                  {!projectId ? (
                    <div className="card empty">
                      पहले client project बनाएँ या project चुनें।
                    </div>
                  ) : tab === "profile" ? (
                    <>
                      <ProjectProfileManager
                        key={projectId}
                        projectId={projectId}
                        notify={notify}
                      />
                      <ProjectCustomerActionsManager
                        key={`customer-actions:${projectId}`}
                        projectId={projectId}
                        notify={notify}
                      />
                      <ProjectPublishPanel projectId={projectId} notify={notify} />
                    </>
                  ) : tab === "mapper" ? (
                    <>
                      <PlotMapper key={projectId} projectId={projectId} notify={notify} />
                      <ProjectStatusThemeManager
                        key={`status-theme:${projectId}`}
                        projectId={projectId}
                        notify={notify}
                      />
                      <ProjectPublishPanel projectId={projectId} notify={notify} />
                    </>
                  ) : tab === "mapping-controls" ? (
                    <>
                      <PlotMapper
                        key={`mapping-controls:${projectId}`}
                        projectId={projectId}
                        notify={notify}
                        workspaceMode="controls"
                      />
                      <ProjectPublishPanel
                        key={`mapping-controls-publish:${projectId}`}
                        projectId={projectId}
                        notify={notify}
                      />
                    </>
                  ) : tab === "geo" ? (
                    <>
                      <GeoLabClone
                        key={`geo-lab:${projectId}`}
                        projectId={projectId}
                        projects={projects}
                        notify={notify}
                      />
                      <GeoMapper key={projectId} projectId={projectId} notify={notify} />
                    </>
                  ) : tab === "accounts" ? (
                    <SalesControls key={projectId} projectId={projectId} notify={notify} />
                  ) : tab === "studio" ? (
                    <>
                      <ProjectAdminStudioManager key={projectId} projectId={projectId} notify={notify} />
                      <ProjectPlotNoticeManager key={`notices:${projectId}`} projectId={projectId} notify={notify} />
                    </>
                  ) : tab === "assets" ? (
                    <ProjectAssetsManager
                      key={`assets:${projectId}`}
                      projectId={projectId}
                      notify={notify}
                    />
                  ) : (
                    <>
                      <ProjectShareManager
                        key={projectId}
                        projectId={projectId}
                        notify={notify}
                      />
                      <ProjectPublishPanel projectId={projectId} notify={notify} />
                    </>
                  )}
                </>
              )}
            </div>
          </MotionSwap>
        </main>
      </section>

      <MotionToast message={toast} />
    </div>
  );
}
