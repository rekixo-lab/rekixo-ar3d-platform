# Metro City — unified four-status workflow

Scope: only the verified active Metro City tenant with its enabled `agreement_done` feature flag. Other projects retain their existing Available / Booked / Sold admin workflow.

## Single source of truth for public presentation

The Client Admin Plot Management view contains exactly one status selector:
**Available / Booked / Registered / Agreement Done**. There is no separate Agreement Done checkbox or editable Deal Progress Agreement field.

| Public status | Canonical inventory `plots.status` | Metro `agreement_done` |
| --- | --- | --- |
| Available | `available` | `false` |
| Booked | `booked` | `false` |
| Registered | `sold` | `false` |
| Agreement Done | `sold` | `true` |

Canonical Sold and the Sales Ledger must not be changed into a new database status. The customer 2D/3D/map/search/status counter all use the effective visible status. Admin four-status counts are exclusive, while Sales & Accounts reports canonical inventory independently.

## Transaction and access requirements

`PATCH /api/client/metro-status` is strictly scoped to the verified, enabled Metro City tenant and authenticated Client Admin. It validates the active plot, previous inventory, agreement flag and revision, then performs inventory and agreement flag changes atomically with a D1 SQL guard against concurrent updates.

**Important distinction:** the four public statuses are builder-maintained inventory milestones. Registered or Agreement Done does **not** certify a financial payment, buyer record or legal registration. A real active Sale is independently recorded and verified in Sales & Accounts; the status action **never** creates or changes a Sale, payment or document.

- Metro Client Admin may select any of the four public statuses on plots with no active financial Sale. This includes historical Registered/Agreement Done plots that were created before Sales & Accounts existed.
- If a real active Sale exists, changing the plot to Available or Booked is blocked to protect the Sale Ledger. Changing between Registered and Agreement Done remains allowed.
- Existing historical status records are left untouched until an authorized Admin explicitly updates a plot. No automatic migrations, false payments or inferred Sales are created.
- When status save fails because of a stale revision, invalid permission or active-Sale protection, the Admin sees a **red error**; successful updates show a separate success notification.

Legacy checkbox and canonical-only Client Admin writes stay blocked. Legacy Deal Progress registered/agreement_done entries are read-only; the single four-status dropdown is the only edit surface for Metro.
  
## Historical data

This release deliberately does **not** rewrite original plot statuses, stored agreement flags, historical Deal Progress, Sale records, buyers, amounts, payments, snapshots, coordinates or masterplans. Legacy Booked/Available + Agreement Done combinations remain stored for controlled reconciliation, but the everyday Client Admin plot list no longer shows repetitive amber 'error' banners. These are historical data inconsistencies rather than runtime failures. The server still enforces active Sale and revision checks before any new status transition. Reconciliation requires separately verified financial records; this UI cleanup must not silently alter inventory or Sale history.

Preserve owner, broker, private notes and finance confidentiality. Regression tests cover transaction guard, revision conflicts, active Sale requirements, tenant boundaries, public four-category filters and original masterplan integrity.
