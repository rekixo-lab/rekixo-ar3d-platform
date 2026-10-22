"use client";
import { displayPlotId } from "./plot-display-id";

import { Check, ChevronUp, LockKeyhole, Pencil, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { bookingAmountInput, canonicalPlotAdminDetails, parseBookingAmount, type PlotAdminDetails } from "./plot-admin-details";

type Plot = {
  id: string;
  sqft: number;
  status: string;
  adminDetails?: PlotAdminDetails | null;
};

type Draft = { ownerName: string; bookingAmount: string; brokerName: string };
type Editor = { plotId: string; baseline: PlotAdminDetails; draft: Draft };
function draftFor(details: PlotAdminDetails): Draft {
  return {
    ownerName: details.ownerName || "",
    bookingAmount: bookingAmountInput(details.bookingAmountPaise),
    brokerName: details.brokerName || "",
  };
}

function hasChanges(editor: Editor | null) {
  if (!editor) return false;
  const original = draftFor(editor.baseline);
  return (Object.keys(original) as (keyof Draft)[]).some(
    (key) => original[key] !== editor.draft[key],
  );
}

function money(paise: number | null) {
  if (paise === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

function isDetails(value: unknown): value is PlotAdminDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as PlotAdminDetails;
  return (
    (details.ownerName === null || typeof details.ownerName === "string") &&
    (details.brokerName === null || typeof details.brokerName === "string") &&
    (details.bookingAmountPaise === null ||
      (Number.isSafeInteger(details.bookingAmountPaise) && details.bookingAmountPaise >= 0)) &&
    Number.isSafeInteger(details.revision) && details.revision >= 0 &&
    (details.updatedAt === null || typeof details.updatedAt === "string")
  );
}

function saveError(error: unknown) {
  if (!(error instanceof Error)) return "Details save nahi hui. Dobara try karein.";
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "Connection nahi ho paaya. Aapki changes yahin hain. Dobara save karein.";
  }
  return error.message || "Details save nahi hui. Dobara try karein.";
}

export default function ClientPlotManagement({
  plots,
  statusBusy,
  loading,
  onStatusChange,
  onSaved,
  onDraftStateChange,
  notify,
}: {
  plots: Plot[];
  statusBusy: string;
  loading: boolean;
  onStatusChange: (plot: Plot, status: string) => void;
  onSaved: (plotId: string, details: PlotAdminDetails) => void;
  onDraftStateChange: (dirty: boolean, saving: boolean) => void;
  notify: (message: string) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<PlotAdminDetails | null>(null);
  const formId = useId();
  const ownerInput = useRef<HTMLInputElement>(null);
  const saveInFlight = useRef(false);
  const dirty = hasChanges(editor);
  const draftStateRef = useRef(onDraftStateChange);
  useEffect(() => {
    draftStateRef.current = onDraftStateChange;
  }, [onDraftStateChange]);

  useEffect(() => {
    draftStateRef.current(dirty, saving);
  }, [dirty, saving]);

  useEffect(() => () => draftStateRef.current(false, false), []);

  useEffect(() => {
    if (!dirty && !saving) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, saving]);

  const editorPlotId = editor?.plotId;
  useEffect(() => {
    if (editorPlotId) ownerInput.current?.focus();
  }, [editorPlotId]);

  function closeEditor() {
    if (saveInFlight.current) return;
    if (dirty && !window.confirm("Unsaved booking details discard karein?")) return;
    setEditor(null);
    setError("");
    setConflict(null);
  }

  function openEditor(plot: Plot) {
    if (saveInFlight.current) return;
    if (editor?.plotId === plot.id) {
      closeEditor();
      return;
    }
    if (dirty && !window.confirm("Current plot ki unsaved booking details discard karke doosra plot kholein?")) return;
    const baseline = canonicalPlotAdminDetails(plot.adminDetails);
    setEditor({ plotId: plot.id, baseline, draft: draftFor(baseline) });
    setError("");
    setConflict(null);
  }

  function changeDraft(key: keyof Draft, value: string) {
    setEditor((current) => current ? { ...current, draft: { ...current.draft, [key]: value } } : current);
    setError("");
  }

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saveInFlight.current || conflict) return;
    const rawAmount = editor.draft.bookingAmount.trim();
    const parsedAmount = parseBookingAmount(rawAmount);
    if (!parsedAmount.ok) {
      setError(parsedAmount.error);
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/client/plot-details", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plotId: editor.plotId,
          expectedRevision: editor.baseline.revision,
          changes: {
            ownerName: editor.draft.ownerName.trim() || null,
            bookingAmount: rawAmount || null,
            brokerName: editor.draft.brokerName.trim() || null,
          },
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean; plotId?: string; error?: string;
        details?: unknown; currentDetails?: unknown; current?: unknown;
      };
      if (response.status === 409) {
        const latest = data.details ?? data.currentDetails ?? data.current;
        if (isDetails(latest)) setConflict(latest);
        throw new Error(data.error || "Doosre admin ne details update ki hain. Aapki changes yahin hain; latest details reload karke dobara edit karein.");
      }
      if (!response.ok) throw new Error(data.error || "Details save nahi hui. Dobara try karein.");
      if (!data.ok || data.plotId !== editor.plotId || !isDetails(data.details)) {
        throw new Error("Saved details verify nahi hui. Aapki changes yahin hain; dobara try karein.");
      }
      onSaved(editor.plotId, data.details);
      notify(`${displayPlotId(editor.plotId)} booking details saved`);
      setEditor(null);
      setConflict(null);
    } catch (failure) {
      setError(saveError(failure));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  function reloadConflict() {
    if (!editor || !conflict || saveInFlight.current) return;
    if (dirty && !window.confirm("Unsaved changes replace karke latest saved details load karein?")) return;
    onSaved(editor.plotId, conflict);
    setEditor({ ...editor, baseline: conflict, draft: draftFor(conflict) });
    setConflict(null);
    setError("");
    ownerInput.current?.focus();
  }

  function renderEditor() {
    if (!editor) return null;
    const errorId = `${formId}-error`;
    return (
      <form className="client-booking-editor" aria-label={`Booking details for ${displayPlotId(editor.plotId)}`} onSubmit={saveDetails}>
        <div className="client-booking-editor-title"><Pencil size={15} aria-hidden="true" />Booking details · {displayPlotId(editor.plotId)}</div>
        <div className="client-booking-fields">
          <label htmlFor={`${formId}-owner`}><span>Plot owner</span><input id={`${formId}-owner`} ref={ownerInput} value={editor.draft.ownerName} onChange={(event) => changeDraft("ownerName", event.target.value)} maxLength={120} autoComplete="off" placeholder="Owner name" disabled={saving} /></label>
          <label htmlFor={`${formId}-amount`}><span>Booking amount</span><div className="client-booking-currency"><span aria-hidden="true">₹</span><input id={`${formId}-amount`} aria-label="Booking amount" aria-describedby={error ? errorId : undefined} type="text" inputMode="decimal" value={editor.draft.bookingAmount} onChange={(event) => changeDraft("bookingAmount", event.target.value)} maxLength={20} autoComplete="off" placeholder="50000.00" disabled={saving} /></div></label>
          <label htmlFor={`${formId}-broker`}><span>Broker</span><input id={`${formId}-broker`} value={editor.draft.brokerName} onChange={(event) => changeDraft("brokerName", event.target.value)} maxLength={120} autoComplete="off" placeholder="Broker name" disabled={saving} /></label>
        </div>
        {error && <div id={errorId} className="client-booking-error" role="alert">{error}</div>}
        {conflict && <div className="client-booking-conflict"><span>Saved: Owner {conflict.ownerName || "—"} · Amount {money(conflict.bookingAmountPaise)} · Broker {conflict.brokerName || "—"}</span><button type="button" onClick={reloadConflict}>Reload saved details</button></div>}
        <div className="client-booking-form-footer"><small><LockKeyhole size={12} aria-hidden="true" />Private admin details</small><div><button type="button" className="client-booking-cancel" disabled={saving} onClick={closeEditor}>Cancel</button><button type="submit" className="client-booking-save" disabled={saving || !dirty || Boolean(conflict)}><Check size={16} aria-hidden="true" />{saving ? "Saving…" : "Save details"}</button></div></div>
      </form>
    );
  }

  const editorOffPage = editor && !plots.some((plot) => plot.id === editor.plotId);
  return (
    <div className="client-booking-list" aria-busy={loading}>
      {editorOffPage && <div className="client-booking-pinned"><p>{displayPlotId(editor.plotId)} ka open form — search ya page badalne par bhi aapki changes yahin hain.</p>{renderEditor()}</div>}
      <div className="client-booking-column-head" aria-hidden="true"><span>Plot</span><span>Area</span><span>Plot owner</span><span>Booking amount</span><span>Broker</span><span>Status</span><span /></div>
      {!plots.length ? <div className="empty">{loading ? "Plots load ho rahe hain…" : "No matching plots found."}</div> : plots.map((plot) => {
        const details = canonicalPlotAdminDetails(plot.adminDetails);
        const hasDetails = Boolean(details.ownerName || details.brokerName || details.bookingAmountPaise !== null);
        const open = editor?.plotId === plot.id;
        return (
          <article key={plot.id} className={`client-booking-plot${open ? " is-editing" : ""}${hasDetails ? " has-details" : ""}`} aria-label={`${displayPlotId(plot.id)}`}>
            <div className="client-booking-summary">
              <b className="client-booking-number">{displayPlotId(plot.id)}</b>
              <div className="client-booking-area">{plot.sqft.toLocaleString("en-IN")}<small>sq.ft</small></div>
              <dl className="client-booking-value client-booking-owner"><dt>Plot owner</dt><dd>{details.ownerName || "—"}</dd></dl>
              <dl className="client-booking-value client-booking-amount"><dt>Booking amount</dt><dd>{money(details.bookingAmountPaise)}</dd></dl>
              <dl className="client-booking-value client-booking-broker"><dt>Broker</dt><dd>{details.brokerName || "—"}</dd></dl>
              <select className={`status-select client-booking-status ${plot.status}`} aria-label={`${plot.id} status`} value={plot.status} disabled={statusBusy === plot.id} onChange={(event) => onStatusChange(plot, event.target.value)}><option value="available">Available</option><option value="booked">Booked</option><option value="sold">Sold</option></select>
              {hasDetails && (
                <div className="client-booking-mobile-meta" aria-label={`Booking summary for ${displayPlotId(plot.id)}`}>
                  <span className="client-booking-mobile-owner" title={details.ownerName || "Owner not set"}>{details.ownerName || "Owner not set"}</span>
                  <span className="client-booking-mobile-amount">{money(details.bookingAmountPaise)}</span>
                  {details.brokerName && <small title={details.brokerName}>Broker: {details.brokerName}</small>}
                </div>
              )}
              {!hasDetails && <span className="client-booking-empty-note">No booking details</span>}
              <button type="button" className="client-booking-edit" aria-label={open ? `Close booking editor for ${displayPlotId(plot.id)}` : `${hasDetails ? "Edit" : "Add"} details for ${displayPlotId(plot.id)}`} aria-expanded={open} disabled={saving} onClick={() => openEditor(plot)}>
                {open ? <ChevronUp size={15} /> : hasDetails ? <Pencil size={15} /> : <Plus size={15} />}
                <span className="client-booking-edit-desktop">{open ? "Editing" : hasDetails ? "Edit details" : "Add details"}</span>
                <span className="client-booking-edit-mobile" aria-hidden="true">{open ? "Close" : hasDetails ? "Edit" : "Add"}</span>
              </button>
            </div>
            {open && renderEditor()}
          </article>
        );
      })}
    </div>
  );
}
