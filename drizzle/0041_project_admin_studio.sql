-- Additive, project-scoped private Admin Studio. Existing plots/sales/public snapshots unchanged.
CREATE TABLE IF NOT EXISTS project_admin_features (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  feature_key TEXT NOT NULL CHECK(feature_key IN ('deal_progress','custom_fields')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,feature_key)
);
CREATE TABLE IF NOT EXISTS project_deal_stages (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK(length(slug) BETWEEN 2 AND 48),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 2 AND 80),
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  requires_sale INTEGER NOT NULL DEFAULT 0 CHECK(requires_sale IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,slug)
);
CREATE TABLE IF NOT EXISTS plot_deal_states (
  project_id TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  stage_slug TEXT,
  hold_until TEXT,
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(project_id,plot_id),
  FOREIGN KEY(project_id,plot_id) REFERENCES plots(project_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,stage_slug) REFERENCES project_deal_stages(project_id,slug) ON DELETE RESTRICT,
  CHECK(length(note)<=600),
  CHECK(hold_until IS NULL OR (length(hold_until)=10 AND hold_until GLOB '????-??-??'))
);
CREATE TABLE IF NOT EXISTS plot_deal_events (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  previous_stage TEXT,
  next_stage TEXT,
  note TEXT NOT NULL DEFAULT '',
  hold_until TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,id),
  FOREIGN KEY(project_id,plot_id) REFERENCES plots(project_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_plot_deal_events_history ON plot_deal_events(project_id,plot_id,created_at DESC);
CREATE TABLE IF NOT EXISTS project_custom_fields (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  field_key TEXT NOT NULL CHECK(length(field_key) BETWEEN 2 AND 48),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 2 AND 80),
  field_type TEXT NOT NULL CHECK(field_type IN ('text','number','date','select','checkbox')),
  choices_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,field_key)
);
CREATE TABLE IF NOT EXISTS plot_custom_values (
  project_id TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(project_id,plot_id,field_key),
  FOREIGN KEY(project_id,plot_id) REFERENCES plots(project_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,field_key) REFERENCES project_custom_fields(project_id,field_key) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_plot_custom_values_plot ON plot_custom_values(project_id,plot_id);

-- Enable ONLY the verified Metro City tenant. No plot, booking, Sale or mapping edits.
INSERT OR IGNORE INTO project_admin_features(project_id,feature_key,enabled,updated_at)
SELECT id,'deal_progress',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
  AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
INSERT OR IGNORE INTO project_admin_features(project_id,feature_key,enabled,updated_at)
SELECT id,'custom_fields',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
  AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
INSERT OR IGNORE INTO project_deal_stages(project_id,slug,label,sort_order,enabled,requires_sale,updated_at)
SELECT id,'hold','Hold',10,1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
  AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
INSERT OR IGNORE INTO project_deal_stages(project_id,slug,label,sort_order,enabled,requires_sale,updated_at)
SELECT id,'token_received','Token Received',20,1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
  AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
INSERT OR IGNORE INTO project_deal_stages(project_id,slug,label,sort_order,enabled,requires_sale,updated_at)
SELECT id,'agreement_done','Agreement Done',30,1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
  AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
INSERT OR IGNORE INTO project_deal_stages(project_id,slug,label,sort_order,enabled,requires_sale,updated_at)
SELECT id,'registered','Registered',40,1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
  AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
