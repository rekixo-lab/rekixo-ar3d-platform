# Metro City — Verified customer terminology and Agreement Done visibility

**Scope:** exact enabled Metro City project only. The canonical inventory and all other projects are unchanged.

## Public Masterplan
- Status labels: **Available / Booked / Registered**, where only canonical `sold` is shown as **Registered**. `booked` remains Booked.
- Count/filter keys, overlays and Sales & Accounts remain `available`, `booked`, `sold`, with original colors and values. "Registered" is customer-requested **display terminology**, not an independent legal-registration verification.
- Plot popup and 2D hover preview use the same project-scoped display function; live status refresh also updates the open popup badge.
- Show an Agreement row **only if** `agreementDone === true`. Render **Agreement Done** then. If missing/false, do not show any Agreement row or Pending message.
- Agreement data is initial-load plus public live-polling scoped to the Metro tenant, boolean only. Never expose buyer, notes, payment or documents.

## Builder
- The existing Client Admin per-plot Agreement Done checkbox auto-saves to the existing custom field with optimistic revision checking and audit.
- The checkbox is the independent source of public Agreement visibility. Saving a separate Deal Progress stage does not silently turn the checkbox ON. Client Admin can enable or disable it explicitly.
- Historical completed Agreement values already backfilled by migration 0043 are **preserved**. This correction does not change or delete database rows.
- No migration, plot remapping, masterplan change, snapshot rewrite, Sale/payment change or repricing.

## Regression requirements
- Metro Booked is Booked, Metro Sold is Registered, unrelated tenants keep Sold.
- With checkbox OFF popup Agreement row is hidden; ON shows Done; toggling OFF via live updates hides row again.
- Status counter, filters, original high-resolution masterplan and 2D/3D remain unchanged.
