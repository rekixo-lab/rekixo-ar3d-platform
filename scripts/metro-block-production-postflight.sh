#!/usr/bin/env bash
# Immediately after D1 migration, before any Worker deployment.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${GITHUB_RUN_ID:?}"
PROJECT='c024a562-634d-4e49-b647-43209f6e450b'
TMP="/tmp/metro-city-block-backup-${GITHUB_RUN_ID}"
test -s "$TMP/plot-fingerprint.sha" || { echo 'STOP: pre-migration METRO backup fingerprint missing'; exit 1; }
SQL="SELECT 'live' AS dataset,id,sqft,sqm,sqyd,dimensions,road,polygon,status FROM plots WHERE project_id='$PROJECT' AND inventory_active=1 UNION ALL SELECT 'published',id,sqft,sqm,sqyd,dimensions,road,polygon,status FROM published_plots WHERE project_id='$PROJECT' ORDER BY dataset,id;"
npx wrangler d1 execute tiyansh-production --remote --config wrangler.jsonc --json --command "$SQL" > "$TMP/after-plots.json"
node scripts/metro-block-production-guard.mjs fingerprint "$TMP/after-plots.json" > "$TMP/after-fingerprint.sha"
cmp -s "$TMP/plot-fingerprint.sha" "$TMP/after-fingerprint.sha" || { echo 'STOP: METRO CITY plot data changed during additive migration'; exit 1; }

# A/B/C is already LIVE: assert that neither draft nor published plot geometry,
# side bindings, or block membership changed during this migration.
test -s "$TMP/block-fingerprint.sha" || { echo 'STOP: METRO CITY block mapping fingerprint missing'; exit 1; }
BLOCK_SQL="SELECT 'draft' AS dataset,plot_id,block_key,polygon,side_bindings FROM metro_block_plot_maps WHERE project_id='$PROJECT' UNION ALL SELECT 'published',plot_id,block_key,polygon,side_bindings FROM metro_block_published_maps WHERE project_id='$PROJECT' ORDER BY dataset,plot_id;"
npx wrangler d1 execute tiyansh-production --remote --config wrangler.jsonc --json --command "$BLOCK_SQL" > "$TMP/after-block-maps.json"
node scripts/metro-block-production-guard.mjs fingerprint "$TMP/after-block-maps.json" > "$TMP/after-block-fingerprint.sha"
cmp -s "$TMP/block-fingerprint.sha" "$TMP/after-block-fingerprint.sha" || { echo 'STOP: METRO CITY A/B/C polygon or side mapping changed during migration'; exit 1; }

npx wrangler d1 execute tiyansh-production --remote --config wrangler.jsonc --json \
  --command "SELECT p.id,p.publish_version AS publishVersion,s.publish_version AS snapshotVersion,(SELECT COUNT(*) FROM plots x WHERE x.project_id=p.id AND x.inventory_active=1) AS activePlots,(SELECT COUNT(*) FROM published_plots x WHERE x.project_id=p.id) AS publishedPlots,COALESCE((SELECT public_enabled FROM metro_block_state WHERE project_id=p.id),-1) AS blockEnabled,COALESCE((SELECT version FROM metro_block_state WHERE project_id=p.id),0) AS blockVersion,(SELECT COUNT(*) FROM metro_block_published_maps WHERE project_id=p.id) AS blockPublishedMaps,(SELECT COUNT(*) FROM metro_block_plot_maps WHERE project_id=p.id) AS blockDraftMaps,(SELECT COUNT(*) FROM metro_block_assets a WHERE a.project_id=p.id AND a.published_version=(SELECT version FROM metro_block_state WHERE project_id=p.id) AND a.published_object_key<>'') AS blockPublishedAssets,(SELECT COUNT(*) FROM metro_block_assets a WHERE a.project_id=p.id AND a.published_view_rotation NOT IN (0,1,2,3)) AS invalidRotations,(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('metro_block_state','metro_block_assets','metro_block_plot_maps','metro_block_published_maps')) AS tableCount FROM projects p LEFT JOIN project_public_snapshots s ON s.project_id=p.id WHERE p.id='$PROJECT';" \
  > "$TMP/after-summary.json"
node scripts/metro-block-production-guard.mjs postflight "$TMP/after-summary.json" "$TMP/before-summary.json"
echo 'METRO CITY postflight passed: 702 canonical plots and A/B/C block mappings unchanged; published state preserved.'
