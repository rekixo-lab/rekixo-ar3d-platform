-- AR3D Platform: one-time correction for the specifically named project.
-- Database: tiyansh-production (Cloudflare D1). Run manually only after reviewing preflight.
-- Leaves project ID, slug, plots, mapping, client admins, domains, and published snapshots unchanged.
-- Fails closed (0 changed rows) if there is not exactly one active project whose
-- name and auto-generated slug both match the original typo.

-- PRECHECK: This MUST return exactly one row before running the UPDATE statements.
SELECT id, slug, name, status, public_status, publish_version
FROM projects
WHERE name = 'HREE DUNGAR RESIDENCY'
  AND slug GLOB 'hree-dungar-residency-*'
  AND status = 'active';

-- Correct only the uncustomized draft branding values derived from the typo.
UPDATE settings
SET value = CASE key
  WHEN 'projectName' THEN 'SHREE DUNGAR RESIDENCY'
  WHEN 'brandName' THEN 'SHREE DUNGAR RESIDENCY'
  WHEN 'brandShort' THEN 'SDR'
  WHEN 'shareTitle' THEN 'SHREE DUNGAR RESIDENCY'
  WHEN 'shareDescription' THEN 'Explore SHREE DUNGAR RESIDENCY with AR 3D interactive plot visualization.'
END,
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE project_id = (
  SELECT id FROM projects
  WHERE name = 'HREE DUNGAR RESIDENCY'
    AND slug GLOB 'hree-dungar-residency-*'
    AND status = 'active'
    AND (SELECT COUNT(*) FROM projects
         WHERE name = 'HREE DUNGAR RESIDENCY'
           AND slug GLOB 'hree-dungar-residency-*'
           AND status = 'active') = 1
)
AND (
  (key IN ('projectName','brandName','shareTitle') AND value = 'HREE DUNGAR RESIDENCY')
  OR (key = 'brandShort' AND value = 'HDR')
  OR (key = 'shareDescription' AND value = 'Explore HREE DUNGAR RESIDENCY with AR 3D interactive plot visualization.')
);

-- Update ONLY the canonical display name, never the stable slug.
UPDATE projects
SET name = 'SHREE DUNGAR RESIDENCY',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE name = 'HREE DUNGAR RESIDENCY'
  AND slug GLOB 'hree-dungar-residency-*'
  AND status = 'active'
  AND (SELECT COUNT(*) FROM projects
       WHERE name = 'HREE DUNGAR RESIDENCY'
         AND slug GLOB 'hree-dungar-residency-*'
         AND status = 'active') = 1;

-- POSTCHECK: Verify the corrected project and its draft display settings.
SELECT p.id, p.slug, p.name, p.public_status, p.publish_version,
       s.key, s.value
FROM projects p
LEFT JOIN settings s ON s.project_id = p.id
  AND s.key IN ('projectName','brandName','brandShort','shareTitle','shareDescription')
WHERE p.name = 'SHREE DUNGAR RESIDENCY'
  AND p.slug GLOB 'hree-dungar-residency-*'
ORDER BY s.key;

-- If this project has an existing published snapshot, republish using the normal
-- Super Admin Publish Update flow. Do not mutate immutable published_* tables.
