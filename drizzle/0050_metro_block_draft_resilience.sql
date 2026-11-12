-- METRO CITY block-only mapper view orientation. Existing polygons are source-image
-- normalized and are NEVER rotated or rewritten by this migration.
ALTER TABLE metro_block_assets
  ADD COLUMN draft_view_rotation INTEGER NOT NULL DEFAULT 0 CHECK (draft_view_rotation IN (0,1,2,3));

-- One immutable R2 snapshot is made BEFORE any destructive replacement of a
-- previously mapped block masterplan. Operator can recover the exact draft.
CREATE TABLE IF NOT EXISTS metro_block_draft_backups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  block_key TEXT NOT NULL CHECK (block_key IN ('a','b','c')),
  object_key TEXT NOT NULL,
  mapped_plots INTEGER NOT NULL,
  draft_revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_metro_block_backup_project
  ON metro_block_draft_backups(project_id,block_key,created_at);
