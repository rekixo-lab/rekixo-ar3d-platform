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

`PATCH /api/client/metro-status` checks same origin, Client Admin role, verified tenant, active plot, expected canonical status, agreement flag and revision, active Sale restrictions and Sales & Accounts settings. It runs a D1 transaction with a revalidated SQL guard before either inventory or agreement writes. Agreement Done requires a confirmed active Sale. Available/Booked are forbidden while an active Sale exists. Registered requires a Sale when Sales & Accounts is enabled.

The legacy checkbox PATCH and Metro-specific canonical-only Client Admin status writes are rejected. The Deal Progress agreement field and legacy registered/agreement_done stages are historical read-only controls, never a competing editable source.

## Historical data

This release deliberately does **not** rewrite original plot statuses, stored agreement flags, historical Deal Progress, Sale records, buyers, amounts, payments, snapshots, coordinates or masterplans. Any legacy Booked/Available + Agreement Done combination is flagged for manual reconciliation in Client Admin Plot Management; selecting a new status enforces current validation.

Preserve owner, broker, private notes and finance confidentiality. Regression tests cover transaction guard, revision conflicts, active Sale requirements, tenant boundaries, public four-category filters and original masterplan integrity.
