"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  Copy,
  Globe2,
  KeyRound,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { generateTemporaryClientPassword } from "./client-password-policy";
import { FUTURE_INVEST_REALTY_ID } from "./customer-direction-policy";

type ClientAdmin = {
  id: string;
  email: string | null;
  loginType: "email" | "mobile";
  loginId: string;
  mobile: string | null;
  name: string;
  role: string;
  status: "active" | "disabled";
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  projectId: string;
  projectName: string;
  projectSlug?: string;
  publicHost: string | null;
  adminHost: string | null;
  projectAdminCount: number;
  projectActiveAdminCount: number;
  adminUrl?: string;
};

type Project = {
  id: string;
  name: string;
  kind: string;
  status: string;
  adminCount: number;
  publicHost: string | null;
  adminHost: string | null;
  loginMode: "email" | "mobile";
};

type ArchivedProject = {
  id: string;
  name: string;
  kind: string;
  status: string;
  deletedAt: string | null;
  adminCount: number;
};

type Audit = {
  action: string;
  actorEmail: string;
  projectId: string | null;
  targetId: string | null;
  createdAt: string;
};

const CLIENT_PAGE_SIZE = 8;
const AUDIT_PAGE_SIZE = 10;
const ARCHIVE_PAGE_SIZE = 8;

export default function ClientAdminManager({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [users, setUsers] = useState<ClientAdmin[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProject[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [existingProjectId, setExistingProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false);
  const [publicHost, setPublicHost] = useState("");
  const [adminHost, setAdminHost] = useState("");
  const [reuseExistingAdmin, setReuseExistingAdmin] = useState(true);
  const [connectedDomain, setConnectedDomain] = useState<{
    publicUrl: string;
    adminUrl: string;
    cloudflareStatus: "attached" | "manual_required";
    message: string;
  } | null>(null);
  const [fallbackAdminUrl, setFallbackAdminUrl] = useState("");
  const [credential, setCredential] = useState<{
    name: string;
    loginId: string;
    loginType: "email" | "mobile";
    password: string;
    adminUrl: string;
  } | null>(null);

  const [clientsOpen, setClientsOpen] = useState(false);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [usersTotal, setUsersTotal] = useState(0);

  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedTotal, setArchivedTotal] = useState(0);

  const [auditsOpen, setAuditsOpen] = useState(false);
  const [auditsLoaded, setAuditsLoaded] = useState(false);
  const [auditsLoading, setAuditsLoading] = useState(false);
  const [auditsTotal, setAuditsTotal] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/admin/users?section=summary", { cache: "no-store" }),
      fetch("/api/admin/users?section=project_options&limit=20", { cache: "no-store" }),
    ])
      .then(async ([summaryResponse, projectResponse]) => {
        const [summary, projectData] = await Promise.all([
          summaryResponse.json(),
          projectResponse.json(),
        ]);
        if (!summaryResponse.ok) throw new Error(summary.error);
        if (!projectResponse.ok) throw new Error(projectData.error);
        if (!active) return;
        setProjects(projectData.projects || []);
        setUsersTotal(Number(summary.userCount || 0));
        setAuditsTotal(Number(summary.auditCount || 0));
        setArchivedTotal(Number(summary.archivedCount || 0));
        setFallbackAdminUrl(summary.clientAdminUrl || "");
      })
      .catch((error) => {
        if (active)
          notify(
            error instanceof Error ? error.message : "Client admins load nahi hue",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setProjectOptionsLoading(true);
      try {
        const query = projectSearch.trim();
        const response = await fetch(
          `/api/admin/users?section=project_options&limit=50&q=${encodeURIComponent(query)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Projects load nahi hue");
        const incoming = (data.projects || []) as Project[];
        setProjects((current) => {
          const selected = current.find((item) => item.id === existingProjectId);
          return selected && !incoming.some((item) => item.id === selected.id)
            ? [selected, ...incoming]
            : incoming;
        });
      } catch (error) {
        if (!controller.signal.aborted)
          notify(error instanceof Error ? error.message : "Projects load nahi hue");
      } finally {
        if (!controller.signal.aborted) setProjectOptionsLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectSearch, existingProjectId, notify]);

  useEffect(() => {
    if (!credential) return;
    const timer = setTimeout(() => setCredential(null), 5*60*1000);
    return () => clearTimeout(timer);
  }, [credential]);

  const selectedProject = projects.find(
    (project) => project.id === existingProjectId,
  );
  const unifiedDomainMode = existingProjectId === FUTURE_INVEST_REALTY_ID &&
    Number(selectedProject?.adminCount || 0) > 0 && reuseExistingAdmin;
  const loginMode: "email" | "mobile" = existingProjectId
    ? selectedProject?.loginMode || "email"
    : "mobile";

  async function loadClients(reset = false) {
    if (clientsLoading) return;
    setClientsLoading(true);
    try {
      const offset = reset ? 0 : users.length;
      const response = await fetch(
        `/api/admin/users?section=clients&limit=${CLIENT_PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Client projects load nahi hue");
      const page = (data.users || []) as ClientAdmin[];
      setUsers((current) =>
        reset
          ? page
          : [
              ...current,
              ...page.filter(
                (item) => !current.some((currentItem) => currentItem.id === item.id),
              ),
            ],
      );
      setUsersTotal(Number(data.total || 0));
      setFallbackAdminUrl(data.clientAdminUrl || fallbackAdminUrl);
      setClientsLoaded(true);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Client projects load nahi hue",
      );
    } finally {
      setClientsLoading(false);
    }
  }

  async function loadArchived(reset = false) {
    if (archivedLoading) return;
    setArchivedLoading(true);
    try {
      const offset = reset ? 0 : archivedProjects.length;
      const response = await fetch(
        `/api/admin/users?section=archived&limit=${ARCHIVE_PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Archived projects load nahi hue");
      const page = (data.archivedProjects || []) as ArchivedProject[];
      setArchivedProjects((current) =>
        reset
          ? page
          : [...current, ...page.filter((item) => !current.some((x) => x.id === item.id))],
      );
      setArchivedTotal(Number(data.total || 0));
      setArchivedLoaded(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Archived projects load nahi hue");
    } finally {
      setArchivedLoading(false);
    }
  }

  async function loadAudits(reset = false) {
    if (auditsLoading) return;
    setAuditsLoading(true);
    try {
      const offset = reset ? 0 : audits.length;
      const response = await fetch(
        `/api/admin/users?section=audits&limit=${AUDIT_PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Security activity load nahi hui");
      const page = (data.audits || []) as Audit[];
      setAudits((current) => (reset ? page : [...current, ...page]));
      setAuditsTotal(Number(data.total || 0));
      setAuditsLoaded(true);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Security activity load nahi hui",
      );
    } finally {
      setAuditsLoading(false);
    }
  }

  async function toggleClients() {
    const next = !clientsOpen;
    setClientsOpen(next);
    if (next && !clientsLoaded) await loadClients(true);
  }

  async function toggleArchived() {
    const next = !archivedOpen;
    setArchivedOpen(next);
    if (next && !archivedLoaded) await loadArchived(true);
  }

  async function toggleAudits() {
    const next = !auditsOpen;
    setAuditsOpen(next);
    if (next && !auditsLoaded) await loadAudits(true);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (unifiedDomainMode) {
      setBusy("create");
      setConnectedDomain(null);
      setCredential(null);
      try {
        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "connect_existing_domain",
            projectId: existingProjectId,
            publicHost,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Domain setup failed");
        setConnectedDomain({
          publicUrl: data.publicUrl,
          adminUrl: data.adminUrl,
          cloudflareStatus: data.cloudflareStatus,
          message: data.message,
        });
        setProjects((current) => current.map((project) =>
          project.id === existingProjectId
            ? { ...project, publicHost: data.host, adminHost: data.host }
            : project,
        ));
        notify(data.cloudflareStatus === "attached"
          ? "Domain Worker से जुड़ गया। SSL/DNS ready होने पर live होगा।"
          : "Domain mapping saved — Cloudflare में Custom Domain जोड़ना बाकी है।");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Domain setup failed");
      } finally {
        setBusy("");
      }
      return;
    }
    const password = generateTemporaryClientPassword();
    setBusy("create");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          loginId,
          password,
          projectId: existingProjectId || undefined,
          projectName,
          publicHost,
          adminHost,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (clientsLoaded) {
        setUsers((current) => [
          data.user,
          ...current.filter((item) => item.id !== data.user.id),
        ]);
      }
      setUsersTotal((current) => current + 1);
      setProjects((current) =>
        current.map((project) =>
          project.id === data.user.projectId
            ? { ...project, adminCount: Number(project.adminCount) + 1 }
            : project,
        ),
      );
      const adminUrl=data.user.adminUrl||data.clientAdminUrl||fallbackAdminUrl;
      setCredential({
        name,
        loginId: data.user.loginId,
        loginType: data.user.loginType,
        password,
        adminUrl,
      });
      setName("");
      setLoginId("");
      setProjectName("");
      setExistingProjectId("");
      setPublicHost("");
      setAdminHost("");
      notify("Client project aur admin access ready hai");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Account create nahi hua");
    } finally {
      setBusy("");
    }
  }

  async function reset(user: ClientAdmin) {
    if (
      !confirm(
        `${user.loginId} ka password reset karein? Iske current sessions logout ho jayenge.`,
      )
    )
      return;
    const password = generateTemporaryClientPassword();
    setBusy(user.id);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          action: "reset_password",
          password,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCredential({
        name: user.name,
        loginId: user.loginId,
        loginType: user.loginType,
        password,
        adminUrl:user.adminUrl||fallbackAdminUrl,
      });
      notify("Naya temporary password ready hai");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Password reset nahi hua");
    } finally {
      setBusy("");
    }
  }

  async function toggle(user: ClientAdmin) {
    setBusy(user.id);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: user.id, action: "toggle" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const activeDelta = data.status === "active" ? 1 : -1;
      setUsers((current) =>
        current.map((item) =>
          item.projectId === user.projectId
            ? {
                ...item,
                ...(item.id === user.id ? { status: data.status } : {}),
                projectActiveAdminCount: Math.max(
                  0,
                  Number(item.projectActiveAdminCount || 0) + activeDelta,
                ),
              }
            : item,
        ),
      );
      notify(
        data.status === "active"
          ? "Client access active hai"
          : "Client access disabled aur sessions revoked hain",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Access update nahi hua");
    } finally {
      setBusy("");
    }
  }

  async function domains(user: ClientAdmin) {
    const website = prompt(
      "Website domain — example: tiyansh.com",
      user.publicHost || "",
    );
    if (website === null) return;
    const admin = prompt(
      "Admin domain — example: admin.tiyansh.com",
      user.adminHost || "",
    );
    if (admin === null) return;
    setBusy(user.id);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          action: "domains",
          publicHost: website,
          adminHost: admin,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id
            ? {
                ...item,
                publicHost: data.publicHost,
                adminHost: data.adminHost,
              }
            : item,
        ),
      );
      notify(
        "Domains mapped hain; Cloudflare custom domains अलग से attach करें",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Domains save nahi hue");
    } finally {
      setBusy("");
    }
  }

  async function remove(user: ClientAdmin) {
    const sameProject = Math.max(1, Number(user.projectAdminCount || 1));
    const activeAdmins = Math.max(0, Number(user.projectActiveAdminCount || 0));
    const removingLastActive =
      user.status === "active" && activeAdmins <= 1;
    const message =
      !removingLastActive
        ? `${user.name} का admin access हटाएँ? Project और बाकी active admins सुरक्षित रहेंगे।`
        : `${user.projectName} का आखिरी active admin हटाने पर project archive होगा। Data, gallery, mapper और Geo files recoverable रहेंगी।`;
    if (!confirm(message)) return;
    setBusy(user.id);
    try {
      const response = await fetch(
        `/api/admin/users?id=${encodeURIComponent(user.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUsers((current) =>
        data.projectDeleted
          ? current.filter((item) => item.projectId !== user.projectId)
          : current
              .filter((item) => item.id !== user.id)
              .map((item) =>
                item.projectId === user.projectId
                  ? {
                      ...item,
                      projectAdminCount: Math.max(0, sameProject - 1),
                      projectActiveAdminCount: Math.max(
                        0,
                        activeAdmins - (user.status === "active" ? 1 : 0),
                      ),
                    }
                  : item,
              ),
      );
      setUsersTotal((current) =>
        Math.max(0, current - (data.projectDeleted ? sameProject : 1)),
      );
      setProjects((current) =>
        data.projectDeleted
          ? current.filter((item) => item.id !== user.projectId)
          : current.map((item) =>
              item.id === user.projectId
                ? {
                    ...item,
                    adminCount: Math.max(0, Number(item.adminCount) - 1),
                  }
                : item,
            ),
      );
      if (data.deletedProject)
        setArchivedProjects((current) => [
          { ...data.deletedProject, status: "deleted", adminCount: 1 },
          ...current.filter((item) => item.id !== data.deletedProject.id),
        ]);
      notify(
        data.projectDeleted
          ? "Project safely archived; data recoverable hai"
          : "Staff admin access हटा diya gaya",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Account delete nahi hua");
    } finally {
      setBusy("");
    }
  }

  async function restoreProject(project: ArchivedProject) {
    if (
      !confirm(
        `${project.name} restore karein? Naye archives me saved domains/admin access state restore hoga aur purane sessions revoke honge. Legacy archive me access safety ke liye disabled rahega.`,
      )
    )
      return;
    setBusy(`restore:${project.id}`);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body:JSON.stringify({action:"restore_project",projectId:project.id}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setArchivedProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      notify(data.accessRestored?"Project aur saved access state restore hua; purane sessions revoked hain":"Project restored; legacy access disabled hai — admin/domain manually enable karein");
      window.location.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Project restore nahi hua");
    } finally {
      setBusy("");
    }
  }

  async function copyCredential() {
    if (!credential) return;
    const label =
      credential.loginType === "mobile" ? "Mobile Login ID" : "Email Login ID";
    await navigator.clipboard.writeText(
      `Admin URL: ${credential.adminUrl}\n${label}: ${credential.loginId}\nTemporary password: ${credential.password}`,
    );
    notify("Login details copy ho gayi");
  }

  return (
    <section className="client-admins">
      <div className="card client-create-card">
        <div className="client-create-head">
          <div className="section-title">
            <UserPlus />
            <div>
              <h2>Create client access</h2>
              <p>
                Existing project में staff admin जोड़ें या नया client project
                बनाइए।
              </p>
            </div>
          </div>
          <button
            type="submit"
            form="client-access-form"
            className="primary client-create-submit"
            disabled={busy === "create"}
          >
            {busy === "create" ? "Saving…" : unifiedDomainMode ? "Connect Customer Domain" : "Create Client Access"}
          </button>
        </div>
        <form
          id="client-access-form"
          className="client-create-form"
          onSubmit={create}
        >
          <label>
            <span>Existing project (optional)</span>
            <input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="Project name search"
              aria-label="Search existing projects"
            />
            <select
              value={existingProjectId}
              onChange={(event) => {
                const project = projects.find((item) => item.id === event.target.value);
                setExistingProjectId(event.target.value);
                setLoginId("");
                setPublicHost(project?.publicHost || "");
                setAdminHost(project?.adminHost || "");
                setReuseExistingAdmin(true);
                setConnectedDomain(null);
              }}
            >
              <option value="">Create a new project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.adminCount} admin
                </option>
              ))}
            </select>
            <small>
              {projectOptionsLoading
                ? "Projects search ho rahe hain…"
                : "Recent 20 projects default; search se maximum 50 matching projects load honge."}
            </small>
          </label>
          {!existingProjectId && (
            <label>
              <span>New project name</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Client project name"
              />
            </label>
          )}
          {existingProjectId === FUTURE_INVEST_REALTY_ID && Number(selectedProject?.adminCount || 0) > 0 && (
            <label className="client-unified-choice">
              <input type="checkbox" checked={reuseExistingAdmin}
                onChange={(event) => { setReuseExistingAdmin(event.target.checked); setConnectedDomain(null); }}/>
              <span>Existing admin reuse करें — वेबसाइट और /admin एक ही domain पर</span>
            </label>
          )}
          {!unifiedDomainMode && <label>
            <span>Client name</span>
            <input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Client or staff name"
            />
          </label>
          {!unifiedDomainMode && <label>
            <span>
              {loginMode === "mobile" ? "Client mobile number" : "Client email"}
            </span>
            <input
              required
              type={loginMode === "mobile" ? "tel" : "email"}
              inputMode={loginMode === "mobile" ? "tel" : "email"}
              autoComplete={loginMode === "mobile" ? "tel" : "email"}
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder={
                loginMode === "mobile" ? "9876543210" : "client@example.com"
              }
            />
            <small>
              {loginMode === "mobile"
                ? "New projects use mobile number as Login ID. +91 optional for Indian 10-digit numbers."
                : "Existing project ka email login unchanged rahega."}
            </small>
          </label>
          <label>
            <span>{unifiedDomainMode ? "Customer website domain" : "Website domain (optional)"}</span>
            <input
              required={unifiedDomainMode}
              value={publicHost}
              onChange={(event) => { setPublicHost(event.target.value); setConnectedDomain(null); }}
              placeholder="www.customer.com"
            />
          </label>
          {unifiedDomainMode && (
            <p className="client-domain-hint" style={{gridColumn:"1 / -1",fontSize:12,color:"#a8c5de"}}>
              Existing admin रहेगा · Login: /admin · नया password नहीं बनेगा।
              {publicHost.trim() && !publicHost.includes("/") ? `  Preview: https://${publicHost.trim()}/admin` : ""}
            </p>
          )}
          {!unifiedDomainMode && <label>
            <span>Admin domain (optional)</span>
            <input
              value={adminHost}
              onChange={(event) => setAdminHost(event.target.value)}
              placeholder="admin.client.com"
            />
          </label>}
        </form>
      </div>

      {connectedDomain && (
        <div className="card" role="status" style={{padding:18,display:"grid",gap:10}}>
          <strong>{connectedDomain.cloudflareStatus === "attached" ? "Cloudflare Worker attached" : "Cloudflare setup pending"}</strong>
          <div><span>Customer website: </span><a href={connectedDomain.publicUrl} target="_blank" rel="noreferrer">{connectedDomain.publicUrl}</a></div>
          <div><span>Existing client admin: </span><a href={connectedDomain.adminUrl} target="_blank" rel="noreferrer">{connectedDomain.adminUrl}</a></div>
          <small>{connectedDomain.message}</small>
          {connectedDomain.cloudflareStatus === "manual_required" && <small>
            Cloudflare → Workers & Pages → rekixo-client-sites → Settings → Domains & Routes → Add Custom Domain.
            SSL जारी होने के बाद दोनों links जाँचें। केवल DNS save होने से website live नहीं होती।
          </small>}
          <button type="button" onClick={() => void navigator.clipboard.writeText(
            `Website: ${connectedDomain.publicUrl}\nClient Admin: ${connectedDomain.adminUrl}`
          )}><Copy /> Copy links</button>
        </div>
      )}

      {credential && (
        <div className="credential-card" role="status">
          <div>
            <ShieldCheck />
            <span>
              <b>Login details ready</b>
              <small>
                Password केवल अभी दिखाई जा रहा है। First login पर client नया
                password बनाएगा।
              </small>
            </span>
          </div>
          <dl>
            <div>
              <dt>Admin URL</dt>
              <dd>{credential.adminUrl}</dd>
            </div>
            <div>
              <dt>
                {credential.loginType === "mobile"
                  ? "Mobile Login ID"
                  : "Email Login ID"}
              </dt>
              <dd>{credential.loginId}</dd>
            </div>
            <div>
              <dt>Temporary password</dt>
              <dd>{credential.password}</dd>
            </div>
          </dl>
          <button onClick={copyCredential}>
            <Copy /> Copy login details
          </button>
          <button
            className="credential-close"
            aria-label="Hide login details"
            onClick={() => setCredential(null)}
          >
            ×
          </button>
        </div>
      )}

      <div
        className={`card client-list-card super-collapsible-card ${clientsOpen ? "is-open" : "is-collapsed"}`}
      >
        <div className="client-list-head super-collapsible-head">
          <div>
            <h2>Client projects & admins</h2>
            <p>हर project, domain और staff access Super Admin से control करें।</p>
          </div>
          <div className="super-collapsible-meta">
            <b>{loading ? "…" : usersTotal}</b>
            <button
              type="button"
              className="super-collapse-toggle"
              aria-label={
                clientsOpen
                  ? "Collapse client projects and admins"
                  : "Expand client projects and admins"
              }
              aria-expanded={clientsOpen}
              onClick={() => void toggleClients()}
            >
              <ChevronDown />
            </button>
          </div>
        </div>

        {clientsOpen && (
          <div className="super-collapsible-body">
            {clientsLoading && !clientsLoaded ? (
              <div className="empty">Client projects load ho rahe hain…</div>
            ) : users.length ? (
              <>
                <div className="client-admin-list">
                  {users.map((user) => (
                    <article key={user.id}>
                      <div className={`client-avatar ${user.status}`}>
                        {user.projectName[0]?.toUpperCase()}
                      </div>
                      <div className="client-identity">
                        <b>{user.projectName}</b>
                        <span>
                          {user.name} · {user.loginId}
                        </span>
                        <small>
                          {user.loginType === "mobile"
                            ? "Mobile login"
                            : "Email login"}
                        </small>
                        <small>
                          Website: {user.publicHost || "pending"} · Admin:{" "}
                          {user.adminHost || "pending"}
                        </small>
                        <small>
                          {user.mustChangePassword
                            ? "Temporary password change pending"
                            : "Password activated"}{" "}
                          · Last login:{" "}
                          {user.lastLoginAt
                            ? new Date(user.lastLoginAt).toLocaleString()
                            : "Never"}
                        </small>
                      </div>
                      <em className={user.status}>{user.status}</em>
                      <div className="client-actions">
                        <button
                          disabled={busy === user.id}
                          onClick={() => domains(user)}
                        >
                          <Globe2 />
                          Domains
                        </button>
                        <button
                          disabled={busy === user.id}
                          onClick={() => reset(user)}
                        >
                          <KeyRound />
                          Reset password
                        </button>
                        <button
                          disabled={busy === user.id}
                          onClick={() => toggle(user)}
                        >
                          {user.status === "active" ? (
                            <>
                              <UserX />
                              Disable
                            </>
                          ) : (
                            <>
                              <UserCheck />
                              Enable
                            </>
                          )}
                        </button>
                        <button
                          className="danger"
                          disabled={busy === user.id}
                          onClick={() => remove(user)}
                        >
                          <Trash2 />
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {users.length < usersTotal && (
                  <button
                    type="button"
                    className="super-load-more"
                    disabled={clientsLoading}
                    onClick={() => void loadClients(false)}
                  >
                    {clientsLoading
                      ? "Loading…"
                      : `Load ${Math.min(CLIENT_PAGE_SIZE, usersTotal - users.length)} more`}
                  </button>
                )}
              </>
            ) : (
              <div className="empty">
                Abhi koi client access nahi hai। ऊपर से पहला project और access
                बनाइए।
              </div>
            )}
          </div>
        )}
      </div>

      {archivedTotal ? (
        <div className={`card client-list-card super-collapsible-card ${archivedOpen ? "is-open" : "is-collapsed"}`}>
          <div className="client-list-head super-collapsible-head">
            <div>
              <h2>Recoverable projects</h2>
              <p>
                Archived project data/R2 safe hai. Restore ke baad admin aur
                domains explicitly re-enable karein.
              </p>
            </div>
            <div className="super-collapsible-meta">
              <b>{archivedTotal}</b>
              <button
                type="button"
                className="super-collapse-toggle"
                aria-label={archivedOpen ? "Collapse recoverable projects" : "Expand recoverable projects"}
                aria-expanded={archivedOpen}
                onClick={() => void toggleArchived()}
              >
                <ChevronDown />
              </button>
            </div>
          </div>
          {archivedOpen && (
            <div className="super-collapsible-body">
              {archivedLoading && !archivedLoaded ? (
                <div className="empty">Archived projects load ho rahe hain…</div>
              ) : (
                <>
                  <div className="client-admin-list">
                    {archivedProjects.map((project) => (
                      <article key={project.id}>
                        <div className="client-avatar disabled">
                          {project.name[0]?.toUpperCase()}
                        </div>
                        <div className="client-identity">
                          <b>{project.name}</b>
                          <span>
                            Archived ·{" "}
                            {project.deletedAt
                              ? new Date(project.deletedAt).toLocaleString()
                              : "time unavailable"}
                          </span>
                          <small>Data retained for recovery</small>
                        </div>
                        <em className="disabled">archived</em>
                        <div className="client-actions">
                          <button
                            disabled={busy === `restore:${project.id}`}
                            onClick={() => restoreProject(project)}
                          >
                            <UserCheck />
                            Restore
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {archivedProjects.length < archivedTotal && (
                    <button
                      type="button"
                      className="super-load-more"
                      disabled={archivedLoading}
                      onClick={() => void loadArchived(false)}
                    >
                      {archivedLoading
                        ? "Loading…"
                        : `Load ${Math.min(ARCHIVE_PAGE_SIZE, archivedTotal - archivedProjects.length)} more`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div
        className={`card audit-card super-collapsible-card ${auditsOpen ? "is-open" : "is-collapsed"}`}
      >
        <div className="client-list-head super-collapsible-head">
          <div>
            <h2>Security activity</h2>
            <p>Owner और client actions on demand load होते हैं।</p>
          </div>
          <div className="super-collapsible-meta">
            <b>{loading ? "…" : auditsTotal}</b>
            <button
              type="button"
              className="super-collapse-toggle"
              aria-label={
                auditsOpen
                  ? "Collapse security activity"
                  : "Expand security activity"
              }
              aria-expanded={auditsOpen}
              onClick={() => void toggleAudits()}
            >
              <ChevronDown />
            </button>
          </div>
        </div>

        {auditsOpen && (
          <div className="super-collapsible-body">
            {auditsLoading && !auditsLoaded ? (
              <div className="empty">Security activity load ho rahi hai…</div>
            ) : audits.length ? (
              <>
                <div className="audit-list">
                  {audits.map((item, index) => (
                    <article key={`${item.createdAt}-${index}`}>
                      <b>{item.action.replaceAll(".", " · ")}</b>
                      <span>{item.actorEmail}</span>
                      <time>{new Date(item.createdAt).toLocaleString()}</time>
                    </article>
                  ))}
                </div>
                {audits.length < auditsTotal && (
                  <button
                    type="button"
                    className="super-load-more"
                    disabled={auditsLoading}
                    onClick={() => void loadAudits(false)}
                  >
                    {auditsLoading
                      ? "Loading…"
                      : `Load ${Math.min(AUDIT_PAGE_SIZE, auditsTotal - audits.length)} more`}
                  </button>
                )}
              </>
            ) : (
              <div className="empty">Abhi कोई activity नहीं है।</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
