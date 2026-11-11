-- SHREE DUNGAR RESIDENCY: refresh cached customer title without republishing
-- the masterplan or changing project identity, share URL, geometry or plot statuses.
-- Previous migration 0045 corrected both live and published metadata, but existing
-- browsers could reuse the one-year immutable structural API response by ?pv=.
-- This project-scoped revision changes the public iframe + structural API URL.
INSERT INTO published_settings(project_id,key,value)
SELECT p.id,'publicDataRevision','shree-dungar-title-corrected-20261111-v2'
FROM projects p
JOIN project_public_snapshots snapshot ON snapshot.project_id=p.id
  AND snapshot.publish_version=p.publish_version
WHERE p.slug='hree-dungar-residency-9176ee'
  AND p.name='SHREE DUNGAR RESIDENCY'
  AND snapshot.project_name='SHREE DUNGAR RESIDENCY'
  AND p.status='active' AND p.public_status='published'
  AND EXISTS (
    SELECT 1 FROM published_settings s
    WHERE s.project_id=p.id AND s.key='projectName'
      AND s.value='SHREE DUNGAR RESIDENCY'
  )
ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value;
