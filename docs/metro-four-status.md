# Metro City — four-colour Status + Agreement Done
Scope: only verified Metro City with the existing `metroAgreementEnabled` server feature gate. No schema migrations, plot edits, source image modifications, polygon remapping or Sales Ledger writes.

## Public Customer Map
- Available = white (#FFFFFF), Booked = yellow (#FFD21A), Registered = green (#1ED46B; display label for canonical `sold`), Agreement Done = red (#FF3030).
- Agreement Done is a *separate existing per-plot Boolean*. When true its red overlay takes priority over other colors in both 2D and 3D; when false the plot returns to its canonical status color.
- The fourth filter selects only plots with agreementDone true. The other three still select their canonical statuses. Counts for Available/Booked/Registered are inventory counts; Agreement Done is a separate overlapping count, and Total is never increased or duplicated.
- Public Plot Details show the Agreement row only if completed. Never show Agreement Pending, payment percentages, or the former Agreement Date.
- Live polling reads the existing project-scoped agreement boolean; new saves do not require a republish.

## Builder Client Admin
- The existing revision-safe Agreement Done checkbox is authoritative, with auto-save and audit.
- Change the visible Sold option to Registered for Metro only; database remains `sold`. Do not add Agreement Done as a fourth inventory status.
- Hide any optional Metro custom field named Agreement Date from the Deal Progress form while retaining stored values for audit/recovery.
- Super Admin project color scheme and all other tenant projects remain unchanged.

## Risk guardrails
- Original SVG polygon coordinates, touch hit-testing, 3D geometry/UVs, HD masterplan image/tile safeguards, status database validation, active-sale checks and booked/sold revenue all remain unchanged.
- Test both viewer modes, mobile Status panel size, Agreement toggle ON/OFF, and cross-project isolation before production merge.
