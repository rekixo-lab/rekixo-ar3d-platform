#!/usr/bin/env bash
# Fail-closed, private production backup BEFORE migrations or Worker deploy.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?Cloudflare CI token required}"
: "${CLOUDFLARE_ACCOUNT_ID:?Cloudflare CI account required}"
: "${GITHUB_RUN_ID:?GitHub workflow run required}"
: "${GITHUB_SHA:?GitHub commit required}"
PROJECT='c024a562-634d-4e49-b647-43209f6e450b'
BUCKET='tiyansh-gallery-production'
DATABASE='tiyansh-production'
TMP="/tmp/metro-city-block-backup-${GITHUB_RUN_ID}"
PREFIX="backups/metro-city/multi-block-deploy/${GITHUB_RUN_ID}-${GITHUB_SHA}"
mkdir -p "$TMP"
chmod 700 "$TMP"
echo 'METRO CITY: validating exact live tenant identity, status totals and published snapshot.'
npx wrangler d1 execute "$DATABASE" --remote --config wrangler.jsonc --json \
  --command "SELECT p.id,p.name,p.slug,p.status,p.public_status AS publicStatus,p.publish_version AS publishVersion,s.publish_version AS snapshotVersion,(SELECT COUNT(*) FROM plots x WHERE x.project_id=p.id AND x.inventory_active=1) AS activePlots,(SELECT COUNT(*) FROM published_plots x WHERE x.project_id=p.id) AS publishedPlots,(SELECT COUNT(*) FROM plots x WHERE x.project_id=p.id AND x.inventory_active=1 AND x.status='available') AS available,(SELECT COUNT(*) FROM plots x WHERE x.project_id=p.id AND x.inventory_active=1 AND x.status='booked') AS booked,(SELECT COUNT(*) FROM plots x WHERE x.project_id=p.id AND x.inventory_active=1 AND x.status='sold') AS sold,COALESCE((SELECT public_enabled FROM metro_block_state WHERE project_id=p.id),-1) AS blockEnabled,COALESCE((SELECT version FROM metro_block_state WHERE project_id=p.id),0) AS blockVersion,(SELECT COUNT(*) FROM metro_block_published_maps WHERE project_id=p.id) AS blockPublishedMaps,(SELECT COUNT(*) FROM metro_block_plot_maps WHERE project_id=p.id) AS blockDraftMaps,(SELECT COUNT(*) FROM metro_block_assets a WHERE a.project_id=p.id AND a.published_version=(SELECT version FROM metro_block_state WHERE project_id=p.id) AND a.published_object_key<>'') AS blockPublishedAssets FROM projects p LEFT JOIN project_public_snapshots s ON s.project_id=p.id WHERE p.id='$PROJECT';" \
  > "$TMP/before-summary.json"
node scripts/metro-block-production-guard.mjs preflight "$TMP/before-summary.json"

# Confirm canonical + published data will remain byte-for-byte identical across migration.
SQL="SELECT 'live' AS dataset,id,sqft,sqm,sqyd,dimensions,road,polygon,status FROM plots WHERE project_id='$PROJECT' AND inventory_active=1 UNION ALL SELECT 'published',id,sqft,sqm,sqyd,dimensions,road,polygon,status FROM published_plots WHERE project_id='$PROJECT' ORDER BY dataset,id;"
npx wrangler d1 execute "$DATABASE" --remote --config wrangler.jsonc --json --command "$SQL" > "$TMP/before-plots.json"
node scripts/metro-block-production-guard.mjs fingerprint "$TMP/before-plots.json" > "$TMP/plot-fingerprint.sha"

# The 702 already-published block polygons are also immutable during deployment.
# Back up and fingerprint draft/published block geometry + side assignments.
BLOCK_SQL="SELECT 'draft' AS dataset,plot_id,block_key,polygon,side_bindings FROM metro_block_plot_maps WHERE project_id='$PROJECT' UNION ALL SELECT 'published',plot_id,block_key,polygon,side_bindings FROM metro_block_published_maps WHERE project_id='$PROJECT' ORDER BY dataset,plot_id;"
npx wrangler d1 execute "$DATABASE" --remote --config wrangler.jsonc --json --command "$BLOCK_SQL" > "$TMP/before-block-maps.json"
node scripts/metro-block-production-guard.mjs fingerprint "$TMP/before-block-maps.json" > "$TMP/block-fingerprint.sha"

echo 'METRO CITY: exporting complete production D1 (private backup; never upload to public GitHub artifacts).'
npx wrangler d1 export "$DATABASE" --remote --config wrangler.jsonc --output "$TMP/production-before.sql" --skip-confirmation > "$TMP/export.log"
test -s "$TMP/production-before.sql"
npx wrangler r2 object put "$BUCKET/$PREFIX/production-before.sql" --remote --config wrangler.jsonc --file "$TMP/production-before.sql" --content-type 'application/sql' > /dev/null
npx wrangler r2 object get "$BUCKET/$PREFIX/production-before.sql" --remote --config wrangler.jsonc --file "$TMP/production-readback.sql" > /dev/null
cmp -s "$TMP/production-before.sql" "$TMP/production-readback.sql" || { echo 'STOP: Cloudflare D1 backup read-back mismatch'; exit 1; }

# Copy previous R2 object bytes to a private, immutable backup prefix.
# A legacy published original may be absent, but the canonical working masterplan MUST exist.
copied=0
for variant in masterplan masterplanPublic logo; do
  source="$BUCKET/projects/$PROJECT/mapper/$variant"
  localfile="$TMP/$variant.bin"
  if npx wrangler r2 object get "$source" --remote --config wrangler.jsonc --file "$localfile" > /dev/null 2>&1; then
    test -s "$localfile"
    npx wrangler r2 object put "$BUCKET/$PREFIX/mapper-$variant.bin" --remote --config wrangler.jsonc --file "$localfile" --content-type 'application/octet-stream' > /dev/null
    npx wrangler r2 object get "$BUCKET/$PREFIX/mapper-$variant.bin" --remote --config wrangler.jsonc --file "$TMP/$variant-readback.bin" > /dev/null
    cmp -s "$localfile" "$TMP/$variant-readback.bin" || { echo "STOP: R2 $variant backup readback mismatch"; exit 1; }
    copied=$((copied+1))
  elif [[ "$variant" == masterplan ]]; then
    echo 'STOP: original Metro City canonical masterplan was not readable; do not migrate/deploy'
    exit 1
  fi
done
echo "$copied" > "$TMP/r2-object-count"
echo 'METRO CITY: production D1 SQL backup and R2 masterplan backups saved privately and verified by read-back.'
echo 'No original production plot, masterplan, client admin, or status data was modified.'
