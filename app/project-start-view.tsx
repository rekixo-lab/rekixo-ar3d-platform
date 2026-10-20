"use client";

import { Crosshair, RotateCcw, Save, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type StartViewMode = "legacy" | "plots" | "custom";
type PlotLike = { polygon?: string };

type StartViewState = {
  mode?: StartViewMode;
  x?: number;
  y?: number;
  error?: string;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mappedBoundsCenter(plots: PlotLike[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const plot of plots) {
    try {
      const points = JSON.parse(plot.polygon || "[]") as unknown;
      if (!Array.isArray(points) || points.length < 3) continue;
      for (const point of points) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > 1 ||
          y < 0 ||
          y > 1
        )
          continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    } catch {
      // Read-only preview helper; malformed polygons are ignored, never rewritten.
    }
  }

  return count
    ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    : null;
}

async function result(response: Response) {
  const data = (await response.json().catch(() => ({}))) as StartViewState;
  if (!response.ok)
    throw new Error(data.error || "Website start view request fail hui");
  return data;
}

export default function ProjectStartView({
  projectId,
  plots,
  masterplanUrl,
  notify,
}: {
  projectId: string;
  plots: PlotLike[];
  masterplanUrl: string;
  notify: (message: string) => void;
}) {
  const autoCenter = useMemo(() => mappedBoundsCenter(plots), [plots]);
  const [mode, setMode] = useState<StartViewMode>("legacy");
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.5);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(
      `/api/admin/project-start-view?projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
    )
      .then(result)
      .then((data) => {
        if (!active) return;
        setMode(data.mode || "legacy");
        setX(clamp01(Number(data.x ?? 0.5)));
        setY(clamp01(Number(data.y ?? 0.5)));
      })
      .catch((error) => {
        if (active)
          notify(
            error instanceof Error
              ? error.message
              : "Website start view load nahi hua",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, notify]);

  function choosePreviewPoint(event: React.MouseEvent<HTMLDivElement>) {
    const image = event.currentTarget.querySelector("img");
    if (!(image instanceof HTMLImageElement)) return;
    const rect = image.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    setX(clamp01((event.clientX - rect.left) / rect.width));
    setY(clamp01((event.clientY - rect.top) / rect.height));
    setMode("custom");
  }

  async function save() {
    if (busy || loading) return;
    if (mode === "plots" && !autoCenter) {
      notify("Mapped plots center ke liye pehle mapped polygons chahiye");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/admin/project-start-view", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode,
          ...(mode === "custom" ? { x, y } : {}),
        }),
      });
      const data = await result(response);
      setMode(data.mode || "legacy");
      setX(clamp01(Number(data.x ?? 0.5)));
      setY(clamp01(Number(data.y ?? 0.5)));
      notify(
        mode === "legacy"
          ? "Start view draft reset save hua. Customer site par lagane ke liye Review & Publish → Publish Update karein."
          : mode === "plots"
            ? "Mapped center draft save hua. Customer site par lagane ke liye Review & Publish → Publish Update karein."
            : "Custom focus draft save hua. Customer site par lagane ke liye Review & Publish → Publish Update karein.",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Website start view save nahi hua",
      );
    } finally {
      setBusy(false);
    }
  }

  const marker =
    mode === "plots" && autoCenter ? autoCenter : { x: clamp01(x), y: clamp01(y) };

  return (
    <section className="mapper-start-view-card">
      <div className="mapper-start-view-head">
        <span className="mapper-start-view-icon">
          <Target />
        </span>
        <div>
          <b>Website Start View</b>
          <small>
            Customer website open / RST par masterplan ka kaunsa part pehle dikhe.
            Polygon geometry sirf read hoti hai, edit nahi.
          </small>
        </div>
      </div>

      <div className="mapper-start-view-modes">
        <label>
          <input
            type="radio"
            name={`start-view-${projectId}`}
            checked={mode === "legacy"}
            disabled={loading || busy}
            onChange={() => setMode("legacy")}
          />
          <span>
            <b>Existing / Auto</b>
            <small>Purana behavior. Existing live projects ke liye zero-change.</small>
          </span>
        </label>

        <label>
          <input
            type="radio"
            name={`start-view-${projectId}`}
            checked={mode === "plots"}
            disabled={loading || busy || !autoCenter}
            onChange={() => setMode("plots")}
          />
          <span>
            <b>Center mapped plots</b>
            <small>
              Mapped polygons ke outer bounds ka center. Horizontal/vertical dono
              masterplans ke liye orientation-independent.
            </small>
          </span>
        </label>

        <label>
          <input
            type="radio"
            name={`start-view-${projectId}`}
            checked={mode === "custom"}
            disabled={loading || busy}
            onChange={() => setMode("custom")}
          />
          <span>
            <b>Custom focus point</b>
            <small>Preview image par tap karke exact opening center choose karein.</small>
          </span>
        </label>
      </div>

      {mode !== "legacy" ? (
        <>
          <div
            className="mapper-start-view-preview"
            onClick={choosePreviewPoint}
            role="button"
            tabIndex={0}
            aria-label="Choose website start focus point"
            onKeyDown={(event) => {
              if (event.key === "Enter" && autoCenter) {
                setX(autoCenter.x);
                setY(autoCenter.y);
                setMode("custom");
              }
            }}
          >
            <img src={masterplanUrl} alt="" draggable={false} />
            <span
              className="mapper-start-view-marker"
              style={{
                left: `${marker.x * 100}%`,
                top: `${marker.y * 100}%`,
              }}
            >
              <Crosshair />
            </span>
          </div>

          <div className="mapper-start-view-meta">
            <span>
              Focus X <b>{(marker.x * 100).toFixed(1)}%</b>
            </span>
            <span>
              Focus Y <b>{(marker.y * 100).toFixed(1)}%</b>
            </span>
            <span>
              Mapped center{" "}
              <b>{autoCenter ? "ready" : "not available"}</b>
            </span>
          </div>

          {mode === "custom" && autoCenter ? (
            <button
              type="button"
              className="mapper-start-view-center"
              disabled={busy}
              onClick={() => {
                setX(autoCenter.x);
                setY(autoCenter.y);
              }}
            >
              <Crosshair /> Use mapped plots center as custom point
            </button>
          ) : null}
        </>
      ) : null}

      <p className="mapper-start-view-publish-note" style={{ margin: 0, color: "#a5bbd2", fontSize: 12 }}>
        Start View yahan save karne se draft badalta hai. Customer site ke liye neeche Review &amp; Publish
        section mein <b>Publish Update</b> karna zaroori hai. Preview se pehle saved mode check karein.
      </p>

      <div className="mapper-start-view-actions">
        <button
          type="button"
          className="primary"
          disabled={loading || busy}
          onClick={() => void save()}
        >
          <Save /> {busy ? "Saving…" : "Save Start View"}
        </button>
        <button
          type="button"
          disabled={loading || busy}
          onClick={() => setMode("legacy")}
        >
          <RotateCcw /> Existing behavior
        </button>
      </div>
    </section>
  );
}
