-- One-project display-name correction: HREE -> SHREE DUNGAR RESIDENCY.
-- Do NOT alter slug, project identity, publish version, published plots, mapping or R2.
-- The exact existing slug and old name guard make this safe and idempotent.
UPDATE projects
SET name='SHREE DUNGAR RESIDENCY'
WHERE slug='hree-dungar-residency-9176ee'
  AND lower(trim(name))='hree dungar residency';

-- Keep draft admin fields consistent. Preserve any custom text around the old name.
UPDATE settings
SET value=substr(value,1,instr(lower(value),'hree dungar residency')-1)
          || 'SHREE DUNGAR RESIDENCY'
          || substr(value,instr(lower(value),'hree dungar residency')+length('hree dungar residency')),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id IN (
  SELECT id FROM projects WHERE slug='hree-dungar-residency-9176ee'
    AND name='SHREE DUNGAR RESIDENCY'
)
AND key IN ('projectName','brandName','shareTitle','shareDescription')
AND instr(lower(value),'hree dungar residency')>0;

-- Only the original auto-generated short brand is corrected; custom brands are unchanged.
UPDATE settings
SET value='SDR',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id IN (
  SELECT id FROM projects WHERE slug='hree-dungar-residency-9176ee'
    AND name='SHREE DUNGAR RESIDENCY'
)
AND key='brandShort' AND upper(trim(value))='HDR';

-- The public customer website uses immutable-version snapshots for its title.
-- Correct text in the EXISTING snapshot; do not republish or touch geometry.
UPDATE project_public_snapshots
SET project_name='SHREE DUNGAR RESIDENCY'
WHERE project_id IN (
  SELECT id FROM projects WHERE slug='hree-dungar-residency-9176ee'
    AND name='SHREE DUNGAR RESIDENCY'
)
AND lower(trim(project_name))='hree dungar residency';

UPDATE published_settings
SET value=substr(value,1,instr(lower(value),'hree dungar residency')-1)
          || 'SHREE DUNGAR RESIDENCY'
          || substr(value,instr(lower(value),'hree dungar residency')+length('hree dungar residency'))
WHERE project_id IN (
  SELECT id FROM projects WHERE slug='hree-dungar-residency-9176ee'
    AND name='SHREE DUNGAR RESIDENCY'
)
AND key IN ('projectName','brandName','shareTitle','shareDescription')
AND instr(lower(value),'hree dungar residency')>0;

UPDATE published_settings
SET value='SDR'
WHERE project_id IN (
  SELECT id FROM projects WHERE slug='hree-dungar-residency-9176ee'
    AND name='SHREE DUNGAR RESIDENCY'
)
AND key='brandShort' AND upper(trim(value))='HDR';
