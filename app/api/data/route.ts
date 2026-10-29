import { env } from "cloudflare:workers";
import { getDb } from "@/modules/db";
import { gallery, plotAdminDetails, plots, settings } from "@/modules/db/schema";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { sameOrigin, validAdminSession } from "@/modules/auth";
import { isClientEditableSettingKey, pickClientVisibleSettings, validClientPlotStatus } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { recordAutomaticPlotNotice } from "@/app/project-plot-notices";
import { validateProjectContactPatch } from "@/modules/projects";
import { canonicalPlotAdminDetails } from "@/app/plot-admin-details";
import {metroAgreementEnabled,metroAgreementValues} from "@/app/metro-agreement";

const denied = () => Response.json({ error: "Admin login required" }, { status: 401 });

/* REKIXO_PLOT_NATURAL_ORDER_V1
   Plot IDs are stored as text because future projects may use alphanumeric IDs.
   Pure numeric IDs sort by numeric value; mixed/alphanumeric IDs remain deterministic
   and case-insensitive. This ordering is stable across pagination and search. */
const plotNaturalOrder = sql`
  CASE
    WHEN ${plots.id} GLOB '[0-9]*' AND ${plots.id} NOT GLOB '*[^0-9]*' THEN 0
    WHEN UPPER(SUBSTR(${plots.id},1,1)) GLOB '[A-Z]'
      AND SUBSTR(${plots.id},2) GLOB '[0-9]*'
      AND SUBSTR(${plots.id},2) NOT GLOB '*[^0-9]*' THEN 1
    ELSE 2
  END,
  CASE
    WHEN ${plots.id} GLOB '[0-9]*' AND ${plots.id} NOT GLOB '*[^0-9]*' THEN CAST(${plots.id} AS INTEGER)
    ELSE NULL
  END,
  CASE WHEN SUBSTR(${plots.id},2) GLOB '[0-9]*'
    AND SUBSTR(${plots.id},2) NOT GLOB '*[^0-9]*'
    THEN SUBSTR(${plots.id},1,1) COLLATE NOCASE ELSE NULL END,
  CASE WHEN SUBSTR(${plots.id},2) GLOB '[0-9]*'
    AND SUBSTR(${plots.id},2) NOT GLOB '*[^0-9]*'
    THEN CAST(SUBSTR(${plots.id},2) AS INTEGER) ELSE NULL END,
  ${plots.id} COLLATE NOCASE,
  ${plots.id}
`;

// This join is used only by this authenticated admin endpoint. Public plot serializers
// continue to read the original plots table, which contains no owner or booking data.
const privateDetailsJoin = and(eq(plotAdminDetails.projectId, plots.projectId), eq(plotAdminDetails.plotId, plots.id));
const adminPlotSelection = { plot: plots, adminDetails: {
  ownerName: plotAdminDetails.ownerName,
  bookingAmountPaise: plotAdminDetails.bookingAmountPaise,
  brokerName: plotAdminDetails.brokerName,
  revision: plotAdminDetails.revision,
  updatedAt: plotAdminDetails.updatedAt,
} };

export async function GET(request: Request) {
  const session = await validAdminSession();
  if (!session) return denied();
  try {
    const db = getDb();
    const requested = new URL(request.url).searchParams.get("projectId");
    const projectId =
      session.role === "super_admin" ? String(requested || "").trim() : session.projectId;
    if (!projectId) {
      return Response.json({ error: "Project required" }, { status: 400 });
    }

    const url = new URL(request.url);
    const section = String(url.searchParams.get("section") || "").trim();
    if (section === "plots") {
      const limitRaw = Number(url.searchParams.get("limit") || 100);
      const offsetRaw = Number(url.searchParams.get("offset") || 0);
      const limit = Math.max(1, Math.min(300, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
      const offset = Math.max(0, Math.min(1_000_000, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0));
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
      const pattern = `%${q.replace(/[%_]/g, "")}%`;
      const where = q
        ? and(eq(plots.projectId, projectId), eq(plots.inventoryActive, true), like(plots.id, pattern))
        : and(eq(plots.projectId, projectId), eq(plots.inventoryActive, true));
      const [pageRows,totalRow,statusRows] = await Promise.all([
        db.select(adminPlotSelection).from(plots).leftJoin(plotAdminDetails, privateDetailsJoin)
          .where(where).orderBy(plotNaturalOrder).limit(limit).offset(offset),
        q
          ? env.DB.prepare("SELECT COUNT(*) AS total FROM plots WHERE project_id=? AND inventory_active=1 AND id LIKE ?").bind(projectId, pattern).first<{ total: number }>()
          : env.DB.prepare("SELECT COUNT(*) AS total FROM plots WHERE project_id=? AND inventory_active=1").bind(projectId).first<{ total: number }>(),
        env.DB.prepare("SELECT status,COUNT(*) AS total FROM plots WHERE project_id=? AND inventory_active=1 GROUP BY status").bind(projectId).all<{ status: string; total: number }>(),
      ]);
      const counts = { available: 0, booked: 0, sold: 0, agreement: 0 };
      const total = Number(totalRow?.total || 0);
      // Both Admin views show the same four exclusive Metro statuses.
      // All other projects retain their original three-status inventory UI.
      const agreementEnabled = await metroAgreementEnabled(projectId);
      const agreementByPlot = agreementEnabled ? await metroAgreementValues(projectId) : new Map<string,{done:boolean;revision:number}>();
      // Admin-only boolean diagnostic; never return buyer or payment details.
      const saleRows=agreementEnabled?await env.DB.prepare(
        "SELECT plot_id AS plotId FROM property_sales WHERE project_id=? AND state='active'"
      ).bind(projectId).all<{plotId:string}>():{results:[] as {plotId:string}[]};
      const activeSalePlots=new Set(saleRows.results.map(row=>row.plotId));
      if(agreementEnabled){
        // Public Metro categories are exclusive; count globally, never from a page.
        const all=await env.DB.prepare("SELECT id,status FROM plots WHERE project_id=? AND inventory_active=1")
          .bind(projectId).all<{id:string;status:string}>();
        for(const row of all.results){
          if(agreementByPlot.get(row.id)?.done){counts.agreement++;continue}
          const key=row.status==="booked"?"booked":row.status==="sold"?"sold":"available";
          counts[key]++;
        }
      }else{
        for(const row of statusRows.results){
          const key=row.status==="booked"?"booked":row.status==="sold"?"sold":"available";
          counts[key]+=Number(row.total||0);
        }
      }
      return Response.json(
        {
          projectId,
          plots: pageRows.map((row) => ({
            ...row.plot,adminDetails:canonicalPlotAdminDetails(row.adminDetails),
            ...(agreementEnabled?{agreementDone:agreementByPlot.get(row.plot.id)?.done||false,
              agreementRevision:agreementByPlot.get(row.plot.id)?.revision||0,
              agreementSaleVerified:activeSalePlots.has(row.plot.id)}:{})
          })),
          agreementEnabled,
          total,
          counts,
          nextOffset: offset + pageRows.length,
          hasMore: offset + pageRows.length < total,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    const [project, plotRows, settingRows, galleryRows] = await Promise.all([
      env.DB.prepare(
        "SELECT name,public_host AS publicHost,admin_host AS adminHost FROM projects WHERE id=? AND status!='deleted' LIMIT 1",
      )
        .bind(projectId)
        .first<{ name: string; publicHost: string | null; adminHost: string | null }>(),
      section === "meta"
        ? Promise.resolve([])
        : db.select(adminPlotSelection).from(plots).leftJoin(plotAdminDetails, privateDetailsJoin)
          .where(and(eq(plots.projectId, projectId),eq(plots.inventoryActive,true))).orderBy(plotNaturalOrder),
      db.select().from(settings).where(eq(settings.projectId, projectId)),
      db
        .select()
        .from(gallery)
        .where(eq(gallery.projectId, projectId))
        .orderBy(desc(gallery.sortOrder)),
    ]);
    const allSettings = Object.fromEntries(settingRows.map((item) => [item.key, item.value]));

    return Response.json(
      {
        projectId,
        projectName: project?.name || "Project",
        publicHost: project?.publicHost || null,
        adminHost: project?.adminHost || null,
        plots: plotRows.map((row) => ({ ...row.plot, adminDetails: canonicalPlotAdminDetails(row.adminDetails) })),
        settings: session.role === "client_admin" ? pickClientVisibleSettings(allSettings) : allSettings,
        gallery: galleryRows,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Admin data load failed", error);
    return Response.json({ error: "Data load nahi hua" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const session = await validAdminSession();
  if (!session) return denied();

  try {
    const body = (await request.json()) as {
      type?: string;
      plot?: Record<string, unknown>;
      settings?: Record<string, string>;
      changes?: Record<string, string>;
      projectId?: string;
      plotId?: string;
      status?: string;
      expectedStatus?: string;
    };
    const db = getDb();
    const now = new Date().toISOString();
    const requestedProjectId = String(
      body.projectId || body.plot?.projectId || "",
    ).trim();
    const projectId =
      session.role === "super_admin" ? requestedProjectId : session.projectId;

    if (!projectId) {
      return Response.json({ error: "Project required" }, { status: 400 });
    }
    if (session.role === "super_admin") {
      const project = await env.DB.prepare(
        "SELECT id FROM projects WHERE id=? AND status!='deleted' LIMIT 1",
      )
        .bind(projectId)
        .first<{ id: string }>();
      if (!project) return Response.json({ error: "Project nahi mila" }, { status: 404 });
    }

    if(body.type==="plotStatus"&&await metroAgreementEnabled(projectId)){
      // No Admin role may bypass Metro's single guarded four-status write
      // route or mutate canonical inventory without its agreement flag.
      return Response.json({error:"Use the Metro four-status dropdown and reload plots.",
        code:"METRO_STATUS_UNIFIED_ROUTE_REQUIRED"},{status:409});
    }
    if (body.type === "plotStatus") {
      const plotId = String(body.plotId || "").trim();
      const status = String(body.status || "");
      const expectedStatus = String(body.expectedStatus || "").trim();
      if (!plotId || plotId.length > 80 || !validClientPlotStatus(status))
        return Response.json({ error: "Invalid plot status" }, { status: 400 });
      if (expectedStatus && !validClientPlotStatus(expectedStatus))
        return Response.json({ error: "Invalid previous plot status" }, { status: 400 });

      const existing = await env.DB.prepare(
        "SELECT id,status,updated_at AS updatedAt FROM plots WHERE project_id=? AND id=? LIMIT 1",
      )
        .bind(projectId, plotId)
        .first<{ id: string; status: string; updatedAt: string | null }>();
      if (!existing) return Response.json({ error: "Plot nahi mila" }, { status: 404 });

      if (expectedStatus && existing.status !== expectedStatus) {
        return Response.json(
          {
            error: "Plot status kisi aur session se badal chuka hai",
            plotId,
            currentStatus: existing.status,
            updatedAt: existing.updatedAt,
          },
          { status: 409, headers: { "cache-control": "no-store" } },
        );
      }

      if (existing.status !== status) {
        // Existing financial records are never silently detached from plot stock.
        const sale=await env.DB.prepare(
          "SELECT id FROM property_sales WHERE project_id=? AND plot_id=? AND state='active' LIMIT 1",
        ).bind(projectId,plotId).first<{id:string}>();
        if(sale && status!=="sold"){
          return Response.json({
            error:"Active Sales Ledger exists for this plot. Its status cannot be changed to Available/Booked.",
            code:"ACTIVE_SALE_STATUS_PROTECTED",saleId:sale.id,
          },{status:409,headers:{"cache-control":"no-store"}});
        }
        if(status==="sold" && !sale){
          const flag=await env.DB.prepare(
            "SELECT value FROM settings WHERE project_id=? AND key='salesAccountsEnabled'",
          ).bind(projectId).first<{value:string}>();
          if(flag?.value==="1"){
            return Response.json({
              error:"Create and confirm the buyer's Sale in Sales & Accounts before marking this plot Sold.",
              code:"SALE_DETAILS_REQUIRED",plotId,
            },{status:409,headers:{"cache-control":"no-store"}});
          }
        }
      }

      // Guard the final update in SQL as well as preflight, so two admin
      // sessions cannot race a Sale insertion or access-toggle change.
      const update=await env.DB.prepare(`UPDATE plots
        SET status=?, updated_at=?
        WHERE project_id=? AND id=? AND status=? AND inventory_active=1
        AND (?='sold' OR NOT EXISTS(
          SELECT 1 FROM property_sales sale
          WHERE sale.project_id=plots.project_id AND sale.plot_id=plots.id AND sale.state='active'
        ))
        AND (?!='sold' OR NOT EXISTS(
          SELECT 1 FROM settings flag
          WHERE flag.project_id=plots.project_id AND flag.key='salesAccountsEnabled' AND flag.value='1'
        ) OR EXISTS(
          SELECT 1 FROM property_sales sale
          WHERE sale.project_id=plots.project_id AND sale.plot_id=plots.id AND sale.state='active'
        ))`)
        .bind(status,now,projectId,plotId,existing.status,status,status)
        .run();
      if(!update.meta.changes){
        return Response.json({error:"Plot status changed in another session. Refresh and retry."},{status:409});
      }

      const persisted = await env.DB.prepare(
        "SELECT status,updated_at AS updatedAt FROM plots WHERE project_id=? AND id=? LIMIT 1",
      )
        .bind(projectId, plotId)
        .first<{ status: string; updatedAt: string | null }>();
      if (!persisted || persisted.status !== status) {
        console.error("Plot status read-back mismatch", {
          projectId,
          plotId,
          requestedStatus: status,
          persistedStatus: persisted?.status || null,
        });
        return Response.json(
          { error: "Status verify nahi hua. Dobara try karein." },
          { status: 500, headers: { "cache-control": "no-store" } },
        );
      }

      if(existing.status!==status)await recordAutomaticPlotNotice(projectId,plotId,"inventory",status==="booked"?"Booked":status==="sold"?(projectId==="c024a562-634d-4e49-b647-43209f6e450b"?"Registered":"Sold"):"Available",`inventory:${plotId}:${now}`,session.id,now);
      await writeAudit(session, "project.plot_status_updated", projectId, plotId, {
        previousStatus: existing.status,
        status,
        persistedStatus: persisted.status,
      });
      return Response.json(
        {
          ok: true,
          projectId,
          plotId,
          previousStatus: existing.status,
          status: persisted.status,
          updatedAt: persisted.updatedAt,
        },
        {
          headers: {
            "cache-control": "no-store",
            "x-rekixo-status-write": "1",
          },
        },
      );
    }

    if (session.role === "super_admin") {
      return Response.json(
        { error: "Use project-specific Super Admin tools" },
        { status: 403 },
      );
    }

    if (session.role === "client_admin" && body.type === "plot")
      return Response.json({ error: "Client can update plot status only" }, { status: 403 });

    if (body.type === "plot" && body.plot?.id) {
      const p = body.plot;
      const status = String(p.status ?? "available");
      const numbers = [Number(p.sqft), Number(p.sqm), Number(p.sqyd)];
      const polygon = String(p.polygon ?? "");
      if (
        !["available", "booked", "sold"].includes(status) ||
        numbers.some((value) => !Number.isFinite(value) || value < 0) ||
        polygon.length > 12000
      ) {
        return Response.json({ error: "Invalid plot data" }, { status: 400 });
      }
      if (polygon) {
        try {
          const points = JSON.parse(polygon);
          if (
            !Array.isArray(points) ||
            points.length < 3 ||
            points.length > 80 ||
            points.some(
              (point) =>
                !Array.isArray(point) ||
                point.length !== 2 ||
                point.some(
                  (value: unknown) =>
                    typeof value !== "number" || value < 0 || value > 1,
                ),
            )
          ) {
            throw new Error();
          }
        } catch {
          return Response.json({ error: "Invalid plot boundary" }, { status: 400 });
        }
      }

      const row = {
        projectId,
        id: String(p.id).slice(0, 80),
        sqft: numbers[0],
        sqm: numbers[1],
        sqyd: numbers[2],
        dimensions: String(p.dimensions ?? "").slice(0, 120),
        road: String(p.road ?? "").slice(0, 160),
        polygon,
        status,
        notes: String(p.notes ?? "").slice(0, 2000),
        featured: Boolean(p.featured),
        updatedAt: now,
      };
      await db
        .insert(plots)
        .values(row)
        .onConflictDoUpdate({ target: [plots.projectId, plots.id], set: row });
      await writeAudit(session, "project.plot_updated", projectId, row.id, {
        status,
        boundary: Boolean(polygon),
      });
      return Response.json({ ok: true, plot: row });
    }

    if (
      (body.type === "settings" && body.settings) ||
      (body.type === "settingsPatch" && body.changes)
    ) {
      const incoming =
        body.type === "settingsPatch" ? body.changes || {} : body.settings || {};
      const rawEntries = Object.entries(incoming);
      if (
        session.role === "client_admin" &&
        rawEntries.some(([key]) => !isClientEditableSettingKey(key))
      )
        return Response.json({ error: "Client setting not allowed" }, { status: 403 });

      let entries: readonly (readonly [string, string])[];
      if (session.role === "client_admin") {
        const checked = validateProjectContactPatch(
          Object.fromEntries(rawEntries),
        );
        if (!checked.ok)
          return Response.json({ error: checked.error }, { status: 400 });
        entries = Object.entries(checked.values).map(
          ([key, value]) => [key, String(value ?? "")] as const,
        );
      } else {
        entries = rawEntries
          .filter(([key, value]) => key.length <= 80 && typeof value === "string")
          .map(([key, value]) => [key, value.slice(0, 2000)] as const);
      }

      if (!entries.length) return Response.json({ ok: true, unchanged: true });

      await db.batch(
        entries.map(([key, value]) =>
          db
            .insert(settings)
            .values({ projectId, key, value, updatedAt: now })
            .onConflictDoUpdate({
              target: [settings.projectId, settings.key],
              set: { value, updatedAt: now },
            }),
        ),
      );
      await writeAudit(session, "project.settings_updated", projectId, null, {
        mode: body.type === "settingsPatch" ? "patch" : "replace-compatible",
        keys: entries.map(([key]) => key),
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    console.error("Admin data save failed", error);
    return Response.json({ error: "Save nahi hua" }, { status: 500 });
  }
}
