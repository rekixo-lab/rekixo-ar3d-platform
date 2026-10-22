import { displayPlotId } from "./plot-display-id";
"use client";

import { Check, IndianRupee, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type PricingRow = {
  plotId: string;
  pricingType: "rate" | "fixed";
  unit: "sqyd" | "sqft" | "sqm";
  rate: number | null;
  fixedPrice: number | null;
  currency: string;
};

type Plot = {
  id: string;
  sqft: number;
  sqm: number;
  sqyd: number;
  pricing?: PricingRow | null;
};

type PricingResponse = {
  enabled?: boolean;
  editable?: boolean;
  plots?: Plot[];
  total?: number;
  pricedCount?: number;
  error?: string;
};

const PRICING_PAGE_SIZE = 250;

const UNIT_LABELS = {
  sqyd: "Sq. Yards",
  sqft: "Sq. Feet",
  sqm: "Sq. Meters",
} as const;

async function jsonResult(response: Response) {
  const data = (await response.json().catch(() => ({}))) as PricingResponse;
  if (!response.ok) throw new Error(data.error || "Pricing request fail hui");
  return data;
}

function pricingErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = String(error.message || "").trim();
  if (
    error.name === "TypeError" ||
    /networkerror|failed to fetch|network request failed|load failed/i.test(message)
  ) {
    return "Pricing service se connection nahi ho paaya. Dobara try karein.";
  }
  return message || fallback;
}

function money(value: number, currency = "INR") {
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  } catch {
    return `₹${Math.round(value).toLocaleString("en-IN")}`;
  }
}

function samePricing(rows: PricingRow[]) {
  if (!rows.length) return null;
  const first = rows[0];
  return rows.every(
    (row) =>
      row.pricingType === first.pricingType &&
      row.unit === first.unit &&
      row.rate === first.rate &&
      row.fixedPrice === first.fixedPrice &&
      row.currency === first.currency,
  )
    ? first
    : null;
}

export default function ClientPlotPricing({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [editable, setEditable] = useState(false);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [total, setTotal] = useState(0);
  const [pricedCount, setPricedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPlotData, setSelectedPlotData] = useState<Record<string, Plot>>({});
  const [query, setQuery] = useState("");
  const [pricingType, setPricingType] = useState<"rate" | "fixed">("rate");
  const [unit, setUnit] = useState<"sqyd" | "sqft" | "sqm">("sqyd");
  const [rate, setRate] = useState("");
  const [fixedPrice, setFixedPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const notifyRef = useRef(notify);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const pageCount = Math.max(1, Math.ceil(total / PRICING_PAGE_SIZE));
  const selectedPlots = useMemo(
    () =>
      selectedIds
        .map((plotId) => selectedPlotData[plotId])
        .filter((plot): plot is Plot => Boolean(plot)),
    [selectedIds, selectedPlotData],
  );

  useEffect(() => {
    setPage(0);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        limit: String(PRICING_PAGE_SIZE),
        offset: String(page * PRICING_PAGE_SIZE),
      });
      if (query.trim()) params.set("q", query.trim());

      fetch(`/api/client/plot-pricing?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(jsonResult)
        .then((data) => {
          setEditable(Boolean(data.enabled && data.editable));
          setPlots(data.plots || []);
          setTotal(Number(data.total || 0));
          setPricedCount(Number(data.pricedCount || 0));
        })
        .catch((error) => {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return;
          notifyRef.current(pricingErrorMessage(error, "Pricing load nahi hui"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoaded(true);
        });
    }, query.trim() ? 220 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [page, query, refreshKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  function applySelection(nextPlots: Plot[]) {
    const unique = [...new Map(nextPlots.map((plot) => [plot.id, plot])).values()];
    setSelectedIds(unique.map((plot) => plot.id));
    setSelectedPlotData(Object.fromEntries(unique.map((plot) => [plot.id, plot])));

    const rows = unique
      .map((plot) => plot.pricing)
      .filter((row): row is PricingRow => Boolean(row));
    if (rows.length !== unique.length) return;

    const shared = samePricing(rows);
    if (!shared) return;
    setPricingType(shared.pricingType);
    setUnit(shared.unit);
    setRate(shared.rate ? String(shared.rate) : "");
    setFixedPrice(shared.fixedPrice ? String(shared.fixedPrice) : "");
  }

  function togglePlot(plot: Plot) {
    if (selectedIds.includes(plot.id)) {
      const nextIds = selectedIds.filter((id) => id !== plot.id);
      const nextData = { ...selectedPlotData };
      delete nextData[plot.id];
      setSelectedIds(nextIds);
      setSelectedPlotData(nextData);
      return;
    }
    const nextIds = [...selectedIds, plot.id];
    const nextData = { ...selectedPlotData, [plot.id]: plot };
    setSelectedIds(nextIds);
    setSelectedPlotData(nextData);

    const rows = nextIds
      .map((plotId) => nextData[plotId]?.pricing)
      .filter((row): row is PricingRow => Boolean(row));
    if (rows.length !== nextIds.length) return;
    const shared = samePricing(rows);
    if (!shared) return;
    setPricingType(shared.pricingType);
    setUnit(shared.unit);
    setRate(shared.rate ? String(shared.rate) : "");
    setFixedPrice(shared.fixedPrice ? String(shared.fixedPrice) : "");
  }

  function previewFor(plot: Plot) {
    if (pricingType === "fixed") {
      const value = Number(fixedPrice);
      return value > 0 ? value : null;
    }
    const unitRate = Number(rate);
    const area = Number(plot[unit]);
    return unitRate > 0 && area > 0 ? area * unitRate : null;
  }

  async function mutate(action: "apply" | "remove") {
    if (busy || !selectedIds.length) return;
    if (
      action === "remove" &&
      !window.confirm(`Selected ${selectedIds.length} plot pricing remove karein?`)
    )
      return;

    setBusy(true);
    try {
      const response = await fetch("/api/client/plot-pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          plotIds: selectedIds,
          ...(action === "apply"
            ? {
                pricingType,
                unit,
                rate: pricingType === "rate" ? Number(rate) : null,
                fixedPrice:
                  pricingType === "fixed" ? Number(fixedPrice) : null,
                currency: "INR",
              }
            : {}),
        }),
      });
      await jsonResult(response);
      setRefreshKey((value) => value + 1);
      notify(
        action === "apply"
          ? `${selectedIds.length} plot pricing save ho gayi`
          : `${selectedIds.length} plot pricing remove ho gayi`,
      );
    } catch (error) {
      notify(pricingErrorMessage(error, "Pricing save nahi hui"));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !editable) return null;

  const numericRate = Number(rate);
  const numericFixed = Number(fixedPrice);
  const canApply =
    selectedIds.length > 0 &&
    (pricingType === "rate" ? numericRate > 0 : numericFixed > 0);

  return (
    <div className="card client-pricing-editor">
      <div className="client-pricing-head">
        <div>
          <p>CLIENT PRICING</p>
          <h2>Plot Pricing</h2>
          <small>
            Sirf selected plot pricing change hogi. Area, polygon, status aur
            mapping untouched rahenge.
          </small>
        </div>
        <span>
          <IndianRupee /> {pricedCount} priced
        </span>
      </div>

      <div className="client-pricing-toolbar">
        <label className="client-pricing-search">
          <Search />
          <input
            value={query}
            placeholder="Plot number search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => applySelection(plots)}>
          Select page ({plots.length})
        </button>
        <button type="button" onClick={() => applySelection([])}>
          Clear selection
        </button>
      </div>

      <div className="client-pricing-plot-list">
        {plots.map((plot) => {
          const row = plot.pricing || null;
          const checked = selectedIds.includes(plot.id);
          return (
            <label key={plot.id} className={checked ? "selected" : ""}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => togglePlot(plot)}
              />
              <b>{plot.id}</b>
              <span>{plot.sqyd.toLocaleString("en-IN")} Sq.Yd</span>
              <em>
                {row
                  ? row.pricingType === "fixed"
                    ? money(Number(row.fixedPrice || 0), row.currency)
                    : `${money(Number(row.rate || 0), row.currency)} / ${UNIT_LABELS[row.unit]}`
                  : "No price"}
              </em>
            </label>
          );
        })}
      </div>

      {total > PRICING_PAGE_SIZE ? (
        <div className="admin-list-pager">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            Previous
          </button>
          <span>
            Page {page + 1} / {pageCount} · {page * PRICING_PAGE_SIZE + 1}-
            {Math.min(total, (page + 1) * PRICING_PAGE_SIZE)} of {total}
          </span>
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            Next
          </button>
        </div>
      ) : null}

      <div className="client-pricing-form">
        <div className="client-pricing-selected">
          Selected <b>{selectedIds.length}</b>
        </div>

        <label>
          <span>Pricing mode</span>
          <select
            value={pricingType}
            onChange={(event) =>
              setPricingType(event.target.value as "rate" | "fixed")
            }
          >
            <option value="rate">Rate × Area</option>
            <option value="fixed">Fixed Price</option>
          </select>
        </label>

        {pricingType === "rate" ? (
          <>
            <label>
              <span>Calculate by</span>
              <select
                value={unit}
                onChange={(event) =>
                  setUnit(event.target.value as "sqyd" | "sqft" | "sqm")
                }
              >
                <option value="sqyd">Sq. Yards</option>
                <option value="sqft">Sq. Feet</option>
                <option value="sqm">Sq. Meters</option>
              </select>
            </label>
            <label>
              <span>Rate / {UNIT_LABELS[unit]}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={rate}
                placeholder="14300"
                onChange={(event) => setRate(event.target.value)}
              />
            </label>
          </>
        ) : (
          <label>
            <span>Fixed price</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={fixedPrice}
              placeholder="2500000"
              onChange={(event) => setFixedPrice(event.target.value)}
            />
          </label>
        )}
      </div>

      {selectedPlots.length ? (
        <div className="client-pricing-preview">
          <b>Automatic Base Price Preview</b>
          {selectedPlots.slice(0, 8).map((plot) => {
            const base = previewFor(plot);
            return (
              <div key={plot.id}>
                <span>
                  {displayPlotId(plot.id)}
                  {pricingType === "rate"
                    ? ` · ${Number(plot[unit]).toLocaleString("en-IN")} ${UNIT_LABELS[unit]}`
                    : ""}
                </span>
                <strong>{base ? money(base) : "—"}</strong>
              </div>
            );
          })}
          {selectedPlots.length > 8 ? (
            <small>+ {selectedPlots.length - 8} aur selected plots</small>
          ) : null}
        </div>
      ) : null}

      <div className="client-pricing-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !canApply}
          onClick={() => void mutate("apply")}
        >
          <Check /> {busy ? "Saving…" : `Apply to ${selectedIds.length || 0} Plot${selectedIds.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy || !selectedIds.length}
          onClick={() => void mutate("remove")}
        >
          <Trash2 /> Remove Price
        </button>
      </div>
    </div>
  );
}
