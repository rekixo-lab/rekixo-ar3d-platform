# METRO CITY Multi-Block Rollout (production-sensitive)

## Guarantees
- This feature is limited to project ID `c024a562-634d-4e49-b647-43209f6e450b` and slug `metro-city-c024a5`.
- Existing `plots`, `published_plots`, `plot_admin_details`, `property_sales`, pricing and 4-status agreement data **are never migrated, copied, recreated, or re-keyed** by this feature.
- Block draft polygons are saved in `metro_block_plot_maps` and published polygons in `metro_block_published_maps`.
- Until `metro_block_state.public_enabled=1`, the existing public route and Admin remain unchanged.
- All 3 new block images must be present and every active plot must have one valid block polygon before the feature can be published.
- Super Admin only: `/admin/metro-blocks`. The client admin is intentionally unchanged.

## Before production deployment
1. Take an external consistent D1 backup/export plus R2 masterplan backup for METRO CITY. Record snapshot version, project ID, 702 expected live active plot count (verify actual production value, not hardcoded), and status breakdown, plus owner/sales counts.
2. Apply `drizzle/0048_metro_city_multi_block.sql` through the existing controlled Cloudflare migration deployment after validating the exact production database and migration status.
3. Run `npm run build` and `node --test tests/*.test.mjs`, and pass independent browser regression checks including Metro 4-status visibility and non-Metro projects.
4. No production block activation on code deployment; state remains absent/disabled.

## Super Admin manual preparation
1. Navigate to `/admin`, select METRO CITY and click **Block A/B/C Mapper**.
2. Initialize plot assignments once. It uses the existing plot IDs and never changes plot status or measurements. Audit unknown IDs and the 702-versus-703 numbering discrepancy. Auto-assignment suggests B/C based on prefixes, other numeric IDs in A; correct any incorrect assignments before publish.
3. Upload the 3 block images (A, B, C) as draft JPEG/PNG/WebP. Use high resolution sources for accurate clicking.
4. Verify each block's North angle. Draft image replacement never edits canonical masterplan; saved polygons must be reviewed/redrawn if image changes perspective.
5. For every active plot, choose the original plot ID and click all polygon corners in sequence, then Save. Map is normalized 0..1 and supports undo/redraw and plot reassignment. Never approve invalid, overlapping or mismatched plots.
6. Perform a human visual overlay audit, particularly at plot borders, roads, parks, common spaces, unusual B/C plot numbers. Validate 702 actual IDs and each block's counts against approved planning documents.
7. Click **Verify & Publish all 3 blocks** only after all three images and every active polygon are verified. This publishes a new immutable block image set and a consistent published block map snapshot, then atomically enables the public selector.
8. Recheck all 3 links and mobile/tablet/desktop 2D and 3D, every public status count and search/plot details, and current client-admin status edits.

## Known limitations / explicit operator checks
- Existing physical area/dimension values remain authoritative. Old polygon edge index semantics cannot safely be transferred to changed image geometry: the new customer block response explicitly clears old edge bindings and hides inferred facing until a new side-binding workflow is completed.
- The North calibration is an operator measurement. The UI starts at 0 degrees; verify against the approved plan before publishing.
- The mapper is a precise, click-vertex editor, not an auto-trace/OCR system. It will not invent 702 polygon boundaries from three JPEG renders. Manual mapping/review is required.
- Source images from chat are not uploaded automatically to production R2. Upload them through the Super Admin UI.
- The legacy combined customer view stays available as rollback.
- Published block images use dedicated versioned R2 keys; do not purge them while readers may still use the version.

## Emergency rollback
Super Admin: `/admin/metro-blocks` → **Restore legacy site (rollback)**. This sets only the block public flag to false and returns the customer root to the original published combined masterplan. It does not touch client admin, sales, plot records or remove draft/published block assets. If the new route is disabled, existing shared project page remains available. Deploy/code rollback is a separate controlled operation.
