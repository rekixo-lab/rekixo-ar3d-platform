-- METRO CITY only: publish a snapshot of the mapper view rotation, separate
-- from editable draft_view_rotation and all canonical plot coordinates.
ALTER TABLE metro_block_assets
 ADD COLUMN published_view_rotation INTEGER NOT NULL DEFAULT 0
 CHECK (published_view_rotation IN (0,1,2,3));

-- Existing LIVE A/B/C publish was created before this column existed.
-- Capture its matching already-saved per-block orientation exactly once.
UPDATE metro_block_assets
 SET published_view_rotation=draft_view_rotation
 WHERE project_id='c024a562-634d-4e49-b647-43209f6e450b'
   AND published_version>0
   AND published_object_key<>''
   AND draft_view_rotation IN (0,1,2,3)
   AND EXISTS (
     SELECT 1 FROM metro_block_state s
     WHERE s.project_id=metro_block_assets.project_id
       AND s.public_enabled=1
       AND s.version=metro_block_assets.published_version
   );
