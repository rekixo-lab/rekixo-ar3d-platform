import { env } from "cloudflare:workers";
import { sameOrigin, validAdminSession } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { canonicalPlotAdminDetails, validatePlotAdminDetailsPatch, type PlotAdminDetails } from "@/app/plot-admin-details";

const headers = { "cache-control": "private, no-store" };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });

const detailColumns = `owner_name AS ownerName,booking_amount_paise AS bookingAmountPaise,
  broker_name AS brokerName,revision,updated_at AS updatedAt`;

async function activePlotDetails(projectId: string, plotId: string) {
  return env.DB.prepare(`
    SELECT p.id,d.owner_name AS ownerName,d.booking_amount_paise AS bookingAmountPaise,
      d.broker_name AS brokerName,d.revision,d.updated_at AS updatedAt
    FROM plots p JOIN projects pr ON pr.id=p.project_id
    LEFT JOIN plot_admin_details d ON d.project_id=p.project_id AND d.plot_id=p.id
    WHERE p.project_id=? AND p.id=? AND p.inventory_active=1 AND pr.status='active'
    LIMIT 1
  `).bind(projectId, plotId).first<PlotAdminDetails & { id: string }>();
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return respond({ error: "Invalid request origin" }, 403);
  const session = await validAdminSession();
  if (!session) return respond({ error: "Admin login required" }, 401);
  if (session.role !== "client_admin") return respond({ error: "Client admin access required" }, 403);

  try {
    const text = await request.text();
    if (text.length > 8192) return respond({ error: "Plot details request is too large" }, 413);
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { return respond({ error: "Invalid JSON request" }, 400); }
    const checked = validatePlotAdminDetailsPatch(body);
    if (!checked.ok) return respond({ error: checked.error }, 400);

    // The project always comes from the verified session, never from user input.
    const projectId = session.projectId;
    const { plotId, expectedRevision, changes } = checked.value;
    const existing = await activePlotDetails(projectId, plotId);
    if (!existing) return respond({ error: "Active plot not found" }, 404);
    const current = canonicalPlotAdminDetails(existing);
    const conflict = (details: PlotAdminDetails) => respond({
      error: "Plot details changed in another session. Reload the saved details before trying again.",
      plotId,
      details,
    }, 409);
    if (current.revision !== expectedRevision) return conflict(current);

    const changedFields = (Object.keys(changes) as Array<keyof typeof changes>)
      .filter((field) => changes[field] !== current[field]);
    if (!changedFields.length) return respond({ ok: true, plotId, details: current });

    const next = { ...current, ...changes };
    const now = new Date().toISOString();
    // Compare-and-set also rechecks active inventory inside the write statement.
    // Concurrent first saves use INSERT ... DO NOTHING; subsequent saves compare revision.
    const persisted = expectedRevision === 0
      ? await env.DB.prepare(`
          INSERT INTO plot_admin_details
            (project_id,plot_id,owner_name,booking_amount_paise,broker_name,revision,updated_at,updated_by)
          SELECT ?,?,?,?,?,1,?,?
          WHERE EXISTS (
            SELECT 1 FROM plots p JOIN projects pr ON pr.id=p.project_id
            WHERE p.project_id=? AND p.id=? AND p.inventory_active=1 AND pr.status='active'
          )
          ON CONFLICT(project_id,plot_id) DO NOTHING
          RETURNING ${detailColumns}
        `).bind(projectId, plotId, next.ownerName, next.bookingAmountPaise, next.brokerName,
          now, session.id, projectId, plotId).first<PlotAdminDetails>()
      : await env.DB.prepare(`
          UPDATE plot_admin_details
          SET owner_name=?,booking_amount_paise=?,broker_name=?,revision=revision+1,updated_at=?,updated_by=?
          WHERE project_id=? AND plot_id=? AND revision=? AND EXISTS (
            SELECT 1 FROM plots p JOIN projects pr ON pr.id=p.project_id
            WHERE p.project_id=plot_admin_details.project_id AND p.id=plot_admin_details.plot_id
              AND p.inventory_active=1 AND pr.status='active'
          )
          RETURNING ${detailColumns}
        `).bind(next.ownerName, next.bookingAmountPaise, next.brokerName, now, session.id,
          projectId, plotId, expectedRevision).first<PlotAdminDetails>();

    if (!persisted) {
      const latest = await activePlotDetails(projectId, plotId);
      if (!latest) return respond({ error: "Active plot not found" }, 404);
      return conflict(canonicalPlotAdminDetails(latest));
    }

    // Audit the affected field names and revision without duplicating private values.
    try {
      await writeAudit(session, "project.plot_admin_details_updated", projectId, plotId, {
        fields: changedFields.map((field) => field === "bookingAmountPaise" ? "bookingAmount" : field),
        revision: persisted.revision,
      });
    } catch {
      // The business write has already committed and RETURNING verified its values.
      // Do not report it as unsaved or log the private fields when only auditing failed.
      console.error("Private plot details saved but audit write failed", {
        projectId, plotId, revision: persisted.revision,
      });
    }
    return respond({ ok: true, plotId, details: canonicalPlotAdminDetails(persisted) });
  } catch (error) {
    console.error("Private plot details save failed", error);
    return respond({ error: "Plot details could not be saved. Please try again." }, 500);
  }
}
