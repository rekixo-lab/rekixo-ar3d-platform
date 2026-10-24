# Rekixo Sales & Accounts · controlled rollout (Phase 5)

**Status: development branch only. No PR, migration, main merge, live enablement, or deployment performed.**

## Existing live data is authoritative
- Old `plot_admin_details.booking_amount_paise` is **not a receipt**.
- Old `plot_pricing` rates are **not automatically final agreement amounts**.
- All original plot IDs, polygons, public snapshots and customer website data remain unchanged.
- Every finance row is scoped by `project_id`; active sale plot references are FK-restricted.
- Use only reviewed additive migration `drizzle/0039_project_sales_accounts.sql`; backup D1 before any production deployment.

## Phase-by-phase enablement
1. **Foundation:** apply additive D1 schema in a staging/test database. Verify no existing plot/booking/price data moved.
2. **Sales Register:** test buyer + agreement creation on an active test plot, and verify another project cannot read it.
3. **Payments:** test part payments, stable idempotency key, duplicate network retries, overpayment rejection, approver reversal, installments, adjustments and report reconciliation. Compare `net sales - net received = balance`.
4. **Super Controls:** project flag `salesAccountsEnabled` defaults to missing/off. An authorised Super Admin must enable and explicitly assign every client's Viewer, Editor, or Approver role. Disabling hides access without deleting data.
5. **Pilot:** start with **Aravalli Green Farms only after approval and verified backups**. No hard-coded project ID or pre-enabled users in application code. Test with explicitly marked dummy entries in staging first, then roll out to selected sites.

## Access rules
- Customer-facing websites and `/api/public-data` must not expose customer names, phone numbers, agreement amounts or payment history.
- Client API derives the project exclusively from a verified session. No public `projectId` parameter controls private reads/writes.
- Viewer = read/export; Editor = create sales, receive payments, schedule installments; Approver = Editor + reverse receipts and add adjustments. Only Super Admin manages grants.
- Every data export is private, project-filtered, escaped for spreadsheet formulas, cache-disabled and audited.
- All money is stored in integer **paise**. Receipt and reversal rows are immutable; no payment DELETE endpoint.
- Receipts must not be backfilled from booking or pricing. Manual import/migration requires separate written approvals and audit.

## Inventory & publish protection
- Mapper CSV preflight and apply reject omitting a plot with any historical sale.
- Publish Update blocks finalization of an inactive financial plot.
- Composite FK `property_sales(project_id,plot_id) -> plots(project_id,id)` restricts hard deletes.
- Plot renumbering with sales must be a dedicated audited sale-to-physical-plot migration. Never silently reuse plot ID.

## Operator final QA before a production PR / CI
- [ ] `npm ci`, `npm run build`, `node --test tests/*.test.mjs` on the final branch.
- [ ] Browser E2E: create sale, browse mobile/tablet, receive 2 installments, reverse 1, print/export and inspect totals.
- [ ] D1 migration locally; simulate failure midway, idempotent schema reapply, project isolation and plot FK.
- [ ] Open Super Admin: feature disabled by default; no users granted; enable + explicitly grant Editor.
- [ ] Verify payment retry and concurrent overpayment prevention; rejected requests leave no partial rows.
- [ ] Confirm old project's 37→36 and B/C mapper/CSV/polygons remain unaffected.
- [ ] Confirm `/api/public-data` contains no buyer, receipts, addresses, or payment totals.
- [ ] Backup and recovery drills, retention policy, approval for personal data and financial exports.
- [ ] Only then create PR; wait for requested CI / review. Do not enable Aravalli or any other live project automatically.

## Limitations for this development iteration
- Export CSV is capped at 5000 rows per request; very large sites will need paginated managed exports.
- `Print Ledger` invokes browser print; no tax invoice/GST-compliant numbered receipt is implied.
- Buyer data is private but fields are not separately encrypted at application level; storage access and data-retention review needed for production finance usage.
- No auto-migration of historic bookings/asking prices. Sale status and customer-visible plot status remain separately editable; reconcile in pilot.
