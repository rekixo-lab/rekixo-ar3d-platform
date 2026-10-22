-- NOORPUR HILLS ESTATE · C6/C7 retirement (published version 13 -> 14)
-- Does not remove or modify the background image, B1..B14, C1..C5 or 1..190.
-- All old draft and published rows are archived before any deletion.
-- The deployment workflow MUST mirror immutable version-12 R2 assets to version 13
-- before executing this SQL, otherwise the new published image would be absent.
DROP TABLE IF EXISTS _noorpur_20261022_preflight;
CREATE TABLE _noorpur_20261022_preflight(ok INTEGER NOT NULL CHECK (ok=1));
INSERT INTO _noorpur_20261022_preflight(ok)
SELECT CASE WHEN
 (SELECT COUNT(*) FROM projects WHERE id='ca24581e-0dbc-41d7-964b-435c563534cd'
  AND name='NOORPUR HILLS ESTATE' AND status='active'
  AND public_status='published' AND publish_version=13)=1
 AND (SELECT COUNT(*) FROM project_public_snapshots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND publish_version=13)=1
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND inventory_active=1)=211
 AND (SELECT COUNT(*) FROM published_plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd')=211
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id IN ('C6','C7')
  AND status='available' AND inventory_active=1 AND TRIM(COALESCE(polygon,''))<>'')=2
 AND (SELECT COUNT(*) FROM published_plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id IN ('C6','C7')
  AND status='available' AND TRIM(COALESCE(polygon,''))<>'')=2
 AND (SELECT COUNT(*) FROM plot_admin_details WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND plot_id IN ('C6','C7')
  AND (COALESCE(TRIM(owner_name),'')<>'' OR booking_amount_paise IS NOT NULL OR COALESCE(TRIM(broker_name),'')<>''))=0
 AND (SELECT COUNT(*) FROM plot_pricing WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND plot_id IN ('C6','C7'))=0
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id LIKE 'B%')=14
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id LIKE 'C%')=7
 THEN 1 ELSE 0 END;

CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_plots AS SELECT * FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';
CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_published_plots AS SELECT * FROM published_plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';
CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_plot_edges AS SELECT * FROM plot_edge_measurements WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';
CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_published_edges AS SELECT * FROM published_plot_edge_measurements WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';
CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_settings AS SELECT * FROM settings WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';
CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_geo AS SELECT * FROM geo_features WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';
CREATE TABLE IF NOT EXISTS noorpur_before_c67_20261022_snapshot AS SELECT * FROM project_public_snapshots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd';

-- Release any geo link to the two retired polygons, but retain geo feature geometry.
UPDATE geo_features SET linked_plot_id=NULL WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND linked_plot_id IN ('C6','C7');
DELETE FROM plot_admin_details WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND plot_id IN ('C6','C7');
DELETE FROM plot_edge_measurements WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND plot_id IN ('C6','C7');
DELETE FROM published_plot_edge_measurements WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND plot_id IN ('C6','C7');
DELETE FROM published_plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id IN ('C6','C7');
DELETE FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id IN ('C6','C7');

UPDATE settings SET value='209',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND key='plotSheetCount';

-- Publish only this project's adjusted inventory. The same image bytes are
-- copied to version 14 in R2 in the earlier guarded deployment step.
UPDATE projects
 SET publish_version=14,published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
     updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id='ca24581e-0dbc-41d7-964b-435c563534cd' AND public_status='published' AND publish_version=13;
UPDATE project_public_snapshots
 SET publish_version=14,created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND publish_version=13;

DROP TABLE IF EXISTS _noorpur_20261022_postcheck;
CREATE TABLE _noorpur_20261022_postcheck(ok INTEGER NOT NULL CHECK (ok=1));
INSERT INTO _noorpur_20261022_postcheck(ok)
SELECT CASE WHEN
 (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND inventory_active=1)=209
 AND (SELECT COUNT(*) FROM published_plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd')=209
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id IN ('C6','C7'))=0
 AND (SELECT COUNT(*) FROM published_plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id IN ('C6','C7'))=0
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id LIKE 'B%')=14
 AND (SELECT COUNT(*) FROM plots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND id LIKE 'C%')=5
 AND (SELECT COUNT(*) FROM projects WHERE id='ca24581e-0dbc-41d7-964b-435c563534cd' AND publish_version=14)=1
 AND (SELECT COUNT(*) FROM project_public_snapshots WHERE project_id='ca24581e-0dbc-41d7-964b-435c563534cd' AND publish_version=14)=1
 THEN 1 ELSE 0 END;
DROP TABLE _noorpur_20261022_preflight;
DROP TABLE _noorpur_20261022_postcheck;
