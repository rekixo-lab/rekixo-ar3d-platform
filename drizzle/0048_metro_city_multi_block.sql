-- METRO CITY ONLY. Additive; never rewrite canonical plots or existing publish snapshots.
CREATE TABLE IF NOT EXISTS metro_block_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metro_block_assets (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  block_key TEXT NOT NULL CHECK (block_key IN ('a','b','c')),
  draft_object_key TEXT NOT NULL DEFAULT '',
  draft_width INTEGER NOT NULL DEFAULT 0,
  draft_height INTEGER NOT NULL DEFAULT 0,
  draft_filename TEXT NOT NULL DEFAULT '',
  draft_north_angle REAL NOT NULL DEFAULT 0,
  published_object_key TEXT NOT NULL DEFAULT '',
  published_width INTEGER NOT NULL DEFAULT 0,
  published_height INTEGER NOT NULL DEFAULT 0,
  published_north_angle REAL NOT NULL DEFAULT 0,
  published_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id,block_key)
);
CREATE TABLE IF NOT EXISTS metro_block_plot_maps (
  project_id TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  block_key TEXT NOT NULL CHECK (block_key IN ('a','b','c')),
  polygon TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id,plot_id),
  FOREIGN KEY (project_id,plot_id) REFERENCES plots(project_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_metro_block_draft_block ON metro_block_plot_maps(project_id,block_key);
CREATE TABLE IF NOT EXISTS metro_block_published_maps (
  project_id TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  block_key TEXT NOT NULL CHECK (block_key IN ('a','b','c')),
  polygon TEXT NOT NULL,
  PRIMARY KEY (project_id,plot_id),
  FOREIGN KEY (project_id,plot_id) REFERENCES plots(project_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_metro_block_published_block ON metro_block_published_maps(project_id,block_key);
