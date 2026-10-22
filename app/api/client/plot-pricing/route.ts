import { env } from "cloudflare:workers";
import { sameOrigin, validAdminSession } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";

const PRICING_ENABLED_KEY = "pricingEnabled";
const CLIENT_PRICING_EDIT_KEY = "clientPricingEditEnabled";
const PRICING_SOURCE_KEY = "pricingLastEditSource";
const MAX_SELECTION = 1000;
const MAX_PAGE_SIZE = 250;

type PricingRow = {
  plotId: string;
  pricingType: "rate" | "fixed";
  unit: "sqyd" | "sqft" | "sqm";
  rate: number | null;
  fixedPrice: number | null;
  currency: string;
};

type PricingPlotRow = {
  id: string;
  sqft: number;
  sqm: number;
  sqyd: number;
  pricingType: "rate" | "fixed" | null;
  unit: "sqyd" | "sqft" | "sqm" | null;
  rate: number | null;
  fixedPrice: number | null;
  currency: string | null;
};

const denied = () =>
  Response.json({ error: "Client Admin login required" }, { status: 401 });

async function permission(projectId: string) {
  const rows = await env.DB.prepare(
    "SELECT key,value FROM settings WHERE project_id=? AND key IN (?,?)",
  )
    .bind(projectId, PRICING_ENABLED_KEY, CLIENT_PRICING_EDIT_KEY)
    .all<{ key: string; value: string }>();
  const values = Object.fromEntries(rows.results.map((row) => [row.key, row.value]));
  const enabled = values[PRICING_ENABLED_KEY] === "1";
  return {
    enabled,
    editable: enabled && values[CLIENT_PRICING_EDIT_KEY] === "1",
  };
}

function settingUpsert(projectId: string, key: string, value: string, now: string) {
  return env.DB.prepare(
    "INSERT INTO settings (project_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  ).bind(projectId, key, value, now);
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1_000_000_000
    ? number
    : null;
}

function cleanPlotIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => item && item.length <= 80),
    ),
  ];
}

async function existingPlotIds(projectId: string, plotIds: string[]) {
  const found = new Set<string>();
  // Keep well below D1/SQLite variable limits and never scan the full inventory.
  for (let index = 0; index < plotIds.length; index += 80) {
    const batch = plotIds.slice(index, index + 80);
    const placeholders = batch.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT id FROM plots WHERE project_id=? AND inventory_active=1 AND id IN (${placeholders})`,
    )
      .bind(projectId, ...batch)
      .all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
  }
  return found;
}

export async function GET(request: Request) {
  const session = await validAdminSession();
  if (!session) return denied();
  if (session.role !== "client_admin")
    return Response.json({ error: "Client Admin access required" }, { status: 403 });

  const projectId = session.projectId;
  const access = await permission(projectId);
  if (!access.enabled || !access.editable) {
    return Response.json(
      { enabled: access.enabled, editable: access.editable, plots: [], total: 0, pricedCount: 0 },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") || MAX_PAGE_SIZE);
  const offsetRaw = Number(url.searchParams.get("offset") || 0);
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : MAX_PAGE_SIZE));
  const offset = Math.max(0, Math.min(1_000_000, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0));
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const filterSql = q ? " AND p.id LIKE ?" : "";
  const rowBindings = q
    ? [projectId, pattern, limit, offset]
    : [projectId, limit, offset];
  const countBindings = q ? [projectId, pattern] : [projectId];

  const [rows, totalRow, pricedRow] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id,p.sqft,p.sqm,p.sqyd,
        pp.pricing_type AS pricingType,pp.unit,pp.rate,
        pp.fixed_price AS fixedPrice,pp.currency
       FROM plots p
       LEFT JOIN plot_pricing pp
         ON pp.project_id=p.project_id AND pp.plot_id=p.id
       WHERE p.project_id=? AND p.inventory_active=1${filterSql}
       ORDER BY
         CASE WHEN p.id GLOB '[0-9]*' AND p.id NOT GLOB '*[^0-9]*' THEN 0
           WHEN UPPER(SUBSTR(p.id,1,1)) GLOB '[A-Z]' AND SUBSTR(p.id,2) GLOB '[0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN 1 ELSE 2 END,
         CASE WHEN p.id GLOB '[0-9]*' AND p.id NOT GLOB '*[^0-9]*' THEN CAST(p.id AS INTEGER) END,
         CASE WHEN SUBSTR(p.id,2) GLOB '[0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN SUBSTR(p.id,1,1) COLLATE NOCASE END,
         CASE WHEN SUBSTR(p.id,2) GLOB '[0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN CAST(SUBSTR(p.id,2) AS INTEGER) END,
         p.id COLLATE NOCASE
       LIMIT ? OFFSET ?`,
    ).bind(...rowBindings).all<PricingPlotRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM plots p WHERE p.project_id=? AND p.inventory_active=1${filterSql}`,
    ).bind(...countBindings).first<{ total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM plot_pricing pp JOIN plots p ON p.project_id=pp.project_id AND p.id=pp.plot_id WHERE pp.project_id=? AND p.inventory_active=1",
    ).bind(projectId).first<{ total: number }>(),
  ]);

  return Response.json(
    {
      enabled: true,
      editable: true,
      plots: rows.results.map((row) => ({
        id: row.id,
        sqft: row.sqft,
        sqm: row.sqm,
        sqyd: row.sqyd,
        pricing: row.pricingType
          ? {
              plotId: row.id,
              pricingType: row.pricingType,
              unit: row.unit || "sqyd",
              rate: row.rate,
              fixedPrice: row.fixedPrice,
              currency: row.currency || "INR",
            } satisfies PricingRow
          : null,
      })),
      total: Number(totalRow?.total || 0),
      pricedCount: Number(pricedRow?.total || 0),
      nextOffset: offset + rows.results.length,
      hasMore: offset + rows.results.length < Number(totalRow?.total || 0),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });

  const session = await validAdminSession();
  if (!session) return denied();
  if (session.role !== "client_admin")
    return Response.json({ error: "Client Admin access required" }, { status: 403 });

  const projectId = session.projectId;
  const access = await permission(projectId);
  if (!access.enabled || !access.editable)
    return Response.json(
      { error: "Client pricing edit permission enabled nahi hai" },
      { status: 403 },
    );

  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        plotIds?: unknown;
        pricingType?: unknown;
        unit?: unknown;
        rate?: unknown;
        fixedPrice?: unknown;
        currency?: unknown;
      }
    | null;

  const action = String(body?.action || "");
  const plotIds = cleanPlotIds(body?.plotIds);
  if (!plotIds.length || plotIds.length > MAX_SELECTION)
    return Response.json(
      { error: `1 se ${MAX_SELECTION} plots select karein` },
      { status: 400 },
    );

  const inventoryIds = await existingPlotIds(projectId, plotIds);
  const unknown = plotIds.filter((plotId) => !inventoryIds.has(plotId));
  if (unknown.length)
    return Response.json(
      { error: `Unknown plot selection: ${unknown.slice(0, 5).join(", ")}` },
      { status: 400 },
    );

  const now = new Date().toISOString();

  if (action === "remove") {
    await env.DB.batch([
      ...plotIds.map((plotId) =>
        env.DB.prepare(
          "DELETE FROM plot_pricing WHERE project_id=? AND plot_id=?",
        ).bind(projectId, plotId),
      ),
      settingUpsert(projectId, PRICING_SOURCE_KEY, "client", now),
    ]);

    await writeAudit(session, "project.client_pricing_removed", projectId, null, {
      count: plotIds.length,
      sample: plotIds.slice(0, 20),
    });

    return Response.json({ ok: true, action, count: plotIds.length });
  }

  if (action !== "apply")
    return Response.json({ error: "Pricing action invalid hai" }, { status: 400 });

  const pricingType = String(body?.pricingType || "rate");
  if (!["rate", "fixed"].includes(pricingType))
    return Response.json({ error: "Pricing type invalid hai" }, { status: 400 });

  const unit = String(body?.unit || "sqyd");
  if (!["sqyd", "sqft", "sqm"].includes(unit))
    return Response.json({ error: "Pricing unit invalid hai" }, { status: 400 });

  const currency = String(body?.currency || "INR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    return Response.json({ error: "Currency invalid hai" }, { status: 400 });

  const rate = pricingType === "rate" ? positiveNumber(body?.rate) : null;
  const fixedPrice =
    pricingType === "fixed" ? positiveNumber(body?.fixedPrice) : null;
  if (pricingType === "rate" && !rate)
    return Response.json({ error: "Rate 0 se bada hona chahiye" }, { status: 400 });
  if (pricingType === "fixed" && !fixedPrice)
    return Response.json(
      { error: "Fixed price 0 se bada hona chahiye" },
      { status: 400 },
    );

  await env.DB.batch([
    ...plotIds.map((plotId) =>
      env.DB.prepare(
        "INSERT INTO plot_pricing (project_id,plot_id,pricing_type,unit,rate,fixed_price,currency,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,plot_id) DO UPDATE SET pricing_type=excluded.pricing_type,unit=excluded.unit,rate=excluded.rate,fixed_price=excluded.fixed_price,currency=excluded.currency,updated_at=excluded.updated_at",
      ).bind(
        projectId,
        plotId,
        pricingType,
        unit,
        rate,
        fixedPrice,
        currency,
        now,
      ),
    ),
    settingUpsert(projectId, PRICING_SOURCE_KEY, "client", now),
  ]);

  await writeAudit(session, "project.client_pricing_updated", projectId, null, {
    count: plotIds.length,
    sample: plotIds.slice(0, 20),
    pricingType,
    unit,
    rate,
    fixedPrice,
    currency,
  });

  return Response.json({ ok: true, action, count: plotIds.length });
}
