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

npx wrangler d1 execute tiyansh-production --remote --config wrangler.jsonc --json \
  --command "SELECT p.id,p.publish_version AS publishVersion,s.publish_version AS snapshotVersion,(SELECT COUNT(*) FROM plots x WHERE x.project_id=p.id AND x.inventory_active=1) AS activePlots,(SELECT COUNT(*) FROM published_plots x WHERE x.project_id=p.id) AS publishedPlots,COALESCE((SELECT public_enabled FROM metro_block_state WHERE project_id=p.id),-1) AS blockEnabled,(SELECT COUNT(*) FROM metro_block_published_maps WHERE project_id=p.id) AS blockPublishedMaps,(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('metro_block_state','metro_block_assets','metro_block_plot_maps','metro_block_published_maps')) AS tableCount FROM projects p LEFT JOIN project_public_snapshots s ON s.project_id=p.id WHERE p.id='$PROJECT';" \
  > "$TMP/after-summary.json"
node scripts/metro-block-production-guard.mjs postflight "$TMP/after-summary.json"
echo 'METRO CITY postflight passed: canonical data match, blocks disabled by default.'
