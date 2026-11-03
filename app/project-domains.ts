import { env } from "cloudflare:workers";
import {
  cleanHostInput,
  domainSupports,
  mergeDomainKind,
  validHostname,
  type DomainKind,
} from "./domain-utils";

type DomainRow = {
  host: string;
  projectId: string;
  kind: DomainKind;
  publicPrimary: number;
  adminPrimary: number;
  status: string;
};

export async function assertDomainAvailable(hostValue: unknown, projectId?: string | null) {
  const host = cleanHostInput(hostValue);
  if (!host || !validHostname(host)) throw new Error("Valid hostname required");

  const reserved = new Set(
    [
      (env as unknown as Record<string, string>).SUPER_ADMIN_HOST || "admin.rekixo.com",
      (env as unknown as Record<string, string>).CLIENT_PLATFORM_HOST || "",
      (env as unknown as Record<string, string>).CLIENT_SHARED_ADMIN_HOST || "",
      (env as unknown as Record<string, string>).CLIENT_FALLBACK_HOST || "",
      (env as unknown as Record<string, string>).LEGACY_FALLBACK_HOST || "",
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (reserved.has(host)) throw new Error("Ye platform-reserved hostname hai");

  const domain = await env.DB.prepare(
    "SELECT project_id AS projectId FROM project_domains WHERE host=? LIMIT 1",
  )
    .bind(host)
    .first<{ projectId: string }>();
  if (domain && domain.projectId !== projectId)
    throw new Error("Domain kisi aur project me use ho raha hai");

  const legacy = await env.DB.prepare(
    "SELECT id FROM projects WHERE status!='deleted' AND (public_host=? OR admin_host=?) LIMIT 1",
  )
    .bind(host, host)
    .first<{ id: string }>();
  if (legacy && legacy.id !== projectId)
    throw new Error("Domain kisi aur project me use ho raha hai");

  return host;
}

export async function upsertPrimaryProjectDomain(
  projectId: string,
  kind: "public" | "admin",
  hostValue: unknown,
  now = new Date().toISOString(),
) {
  const column = kind === "public" ? "public_host" : "admin_host";
  const primaryColumn = kind === "public" ? "public_primary" : "admin_primary";
  const host = cleanHostInput(hostValue);

  if (!host) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE projects SET ${column}=NULL,updated_at=? WHERE id=?`).bind(
        now,
        projectId,
      ),
      env.DB.prepare(
        `UPDATE project_domains SET ${primaryColumn}=0,updated_at=? WHERE project_id=?`,
      ).bind(now, projectId),
    ]);
    return null;
  }

  await assertDomainAvailable(host, projectId);

  const existing = await env.DB.prepare(
    "SELECT host,project_id AS projectId,kind,public_primary AS publicPrimary,admin_primary AS adminPrimary,status FROM project_domains WHERE host=? LIMIT 1",
  )
    .bind(host)
    .first<DomainRow>();

  const statements = [
    env.DB.prepare(
      `UPDATE project_domains SET ${primaryColumn}=0,updated_at=? WHERE project_id=?`,
    ).bind(now, projectId),
  ];

  if (existing) {
    const merged = mergeDomainKind(existing.kind, kind);
    statements.push(
      env.DB.prepare(
        `UPDATE project_domains SET kind=?,status='active',${primaryColumn}=1,updated_at=? WHERE host=? AND project_id=?`,
      ).bind(merged, now, host, projectId),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "INSERT INTO project_domains (host,project_id,kind,public_primary,admin_primary,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)",
      ).bind(
        host,
        projectId,
        kind,
        kind === "public" ? 1 : 0,
        kind === "admin" ? 1 : 0,
        now,
        now,
      ),
    );
  }

  statements.push(
    env.DB.prepare(`UPDATE projects SET ${column}=?,updated_at=? WHERE id=?`).bind(
      host,
      now,
      projectId,
    ),
  );

  await env.DB.batch(statements);
  return host;
}

export async function activeProjectDomain(
  projectId: string,
  kind: "public" | "admin",
) {
  const primaryColumn = kind === "public" ? "public_primary" : "admin_primary";
  const rows = await env.DB.prepare(
    `SELECT host,kind,${primaryColumn} AS primaryValue FROM project_domains WHERE project_id=? AND status='active' ORDER BY ${primaryColumn} DESC,created_at ASC`,
  )
    .bind(projectId)
    .all<{ host: string; kind: DomainKind; primaryValue: number }>();
  return rows.results.find((row) => domainSupports(row.kind, kind))?.host || null;
}

export async function deleteProjectDomain(projectId: string, hostValue: unknown) {
  const host = cleanHostInput(hostValue);
  if (!host) throw new Error("Hostname required");
  const row = await env.DB.prepare(
    "SELECT host,project_id AS projectId,kind,public_primary AS publicPrimary,admin_primary AS adminPrimary FROM project_domains WHERE host=? LIMIT 1",
  )
    .bind(host)
    .first<{
      host: string;
      projectId: string;
      kind: DomainKind;
      publicPrimary: number;
      adminPrimary: number;
    }>();
  if (!row || row.projectId !== projectId) throw new Error("Project domain nahi mila");

  await env.DB.prepare("DELETE FROM project_domains WHERE host=? AND project_id=?")
    .bind(host, projectId)
    .run();

  const now = new Date().toISOString();
  if (row.publicPrimary) {
    const replacement = await activeProjectDomain(projectId, "public");
    await env.DB.prepare("UPDATE projects SET public_host=?,updated_at=? WHERE id=?")
      .bind(replacement, now, projectId)
      .run();
  }
  if (row.adminPrimary) {
    const replacement = await activeProjectDomain(projectId, "admin");
    await env.DB.prepare("UPDATE projects SET admin_host=?,updated_at=? WHERE id=?")
      .bind(replacement, now, projectId)
      .run();
  }
}


/**
 * Set one existing customer's hostname as both public website and /admin entry.
 * Preserves historical host aliases, other tenants, existing users and plot data.
 */
export async function upsertUnifiedProjectDomain(projectId: string, hostValue: unknown) {
  const host = await assertDomainAvailable(hostValue, projectId);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT project_id AS projectId FROM project_domains WHERE host=? LIMIT 1",
  ).bind(host).first<{ projectId: string }>();
  if (existing && existing.projectId !== projectId)
    throw new Error("Domain kisi aur project me use ho raha hai");

  const statements = [
    env.DB.prepare(
      "UPDATE project_domains SET public_primary=0,admin_primary=0,updated_at=? WHERE project_id=?",
    ).bind(now, projectId),
    existing
      ? env.DB.prepare(
          "UPDATE project_domains SET kind='both',status='active',public_primary=1,admin_primary=1,updated_at=? WHERE host=? AND project_id=?",
        ).bind(now, host, projectId)
      : env.DB.prepare(
          "INSERT INTO project_domains (host,project_id,kind,public_primary,admin_primary,status,created_at,updated_at) VALUES (?,?,'both',1,1,'active',?,?)",
        ).bind(host, projectId, now, now),
    env.DB.prepare(
      "UPDATE projects SET public_host=?,admin_host=?,updated_at=? WHERE id=? AND status='active'",
    ).bind(host, host, now, projectId),
  ];
  await env.DB.batch(statements);
  return host;
}
