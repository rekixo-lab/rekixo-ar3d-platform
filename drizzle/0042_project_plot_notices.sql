-- Private tenant-scoped plot update drafts and explicitly approved public notices.
-- No changes to existing plots, sales, inventory, mappings, or customer snapshots.
CREATE TABLE IF NOT EXISTS project_plot_notice_settings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_plot_notices (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 id TEXT NOT NULL,
 event_date TEXT NOT NULL CHECK(length(event_date)=10 AND event_date GLOB '????-??-??'),
 category TEXT NOT NULL CHECK(category IN ('inventory','deal')),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 2 AND 70),
 plot_ids_json TEXT NOT NULL CHECK(json_valid(plot_ids_json)),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','hidden')),
 source TEXT NOT NULL CHECK(source IN ('automatic','admin_reference','manual')),
 source_event_id TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 published_at TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,id),
 UNIQUE(project_id,source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_project_plot_notices_public ON project_plot_notices(project_id,state,event_date DESC,created_at DESC);
-- Only verified Metro City is enabled. Other tenants keep default disabled.
INSERT OR IGNORE INTO project_plot_notice_settings(project_id,enabled,updated_at)
 SELECT id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects
 WHERE id='c024a562-634d-4e49-b647-43209f6e450b'
 AND slug='metro-city-c024a5' AND name='Metro City' AND status='active';
-- Customer provided these historical samples. They remain PRIVATE DRAFTS
-- until Super Admin explicitly verifies and publishes each entry.
INSERT OR IGNORE INTO project_plot_notices
 (project_id,id,event_date,category,label,plot_ids_json,state,source,source_event_id,created_by,created_at,published_at,updated_at)
 SELECT id,'reference-20261012-hold','2026-10-12','deal','On Hold','["18","48","231"]','draft','admin_reference','reference-20261012-hold','customer_reference',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b' AND slug='metro-city-c024a5' AND name='Metro City' AND status='active'
 AND (SELECT COUNT(*) FROM plots WHERE project_id=projects.id AND inventory_active=1 AND id IN ('18','48','231'))=3;
INSERT OR IGNORE INTO project_plot_notices
 (project_id,id,event_date,category,label,plot_ids_json,state,source,source_event_id,created_by,created_at,published_at,updated_at)
 SELECT id,'reference-20261012-booked','2026-10-12','inventory','Booked','["66","67"]','draft','admin_reference','reference-20261012-booked','customer_reference',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b' AND slug='metro-city-c024a5' AND name='Metro City' AND status='active'
 AND (SELECT COUNT(*) FROM plots WHERE project_id=projects.id AND inventory_active=1 AND id IN ('66','67'))=2;
INSERT OR IGNORE INTO project_plot_notices
 (project_id,id,event_date,category,label,plot_ids_json,state,source,source_event_id,created_by,created_at,published_at,updated_at)
 SELECT id,'reference-20261012-agreement','2026-10-12','deal','Agreement Done','["17","263"]','draft','admin_reference','reference-20261012-agreement','customer_reference',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM projects WHERE id='c024a562-634d-4e49-b647-43209f6e450b' AND slug='metro-city-c024a5' AND name='Metro City' AND status='active'
 AND (SELECT COUNT(*) FROM plots WHERE project_id=projects.id AND inventory_active=1 AND id IN ('17','263'))=2;
