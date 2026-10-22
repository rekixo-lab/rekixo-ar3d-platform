-- TALIB NAZAMI ALAM PLOTING · 37 -> 36 residential plots
-- Only the exact audited project, draft inventory and uploaded 4096x2304 plan.
-- Published customer snapshot and published masterplan are deliberately UNCHANGED:
-- they may be advanced together only after new 36-plot polygons are verified.
-- Fail closed on changed inventory, commercial plot bookings/pricing or image.
DROP TABLE IF EXISTS _talib_20261022_guard;
CREATE TABLE _talib_20261022_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _talib_20261022_guard(ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM projects
  WHERE id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND name='TALIB NAZAMI ALAM  PLOTING'
    AND slug='talib-nazami-alam-ploting-e94cec'
    AND status='active' AND public_status='published' AND publish_version=2
)=1
AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1)=37
AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1
      AND id IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37'))=37
AND (SELECT COUNT(*) FROM published_plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2')=37
AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='masterplanName')='1_2 - Photo.jpg.mapping.webp'
AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapWidth')='4096'
AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapHeight')='2304'
AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
  AND id IN ('32','33','34','35','36','37')
  AND (status<>'available' OR TRIM(COALESCE(polygon,''))<>''))=0
AND (SELECT COUNT(*) FROM plot_pricing WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND plot_id IN ('32','33','34','35','36','37'))=0
AND (SELECT COUNT(*) FROM plot_admin_details WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND plot_id IN ('32','33','34','35','36','37')
  AND (COALESCE(TRIM(owner_name),'')<>'' OR booking_amount_paise IS NOT NULL OR COALESCE(TRIM(broker_name),'')<>''))=0
AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='32' AND sqft BETWEEN 14548.70 AND 14548.82)=1
AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='33' AND sqft BETWEEN 2741.20 AND 2741.30)=1
AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='37' AND sqft BETWEEN 5730.48 AND 5730.58)=1
THEN 1 ELSE 0 END;
-- Persistent complete project-scoped backup. Old Plot 32 remains here as commercial archive.
CREATE TABLE IF NOT EXISTS talib_before_36_20261022_plots AS SELECT * FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
CREATE TABLE IF NOT EXISTS talib_before_36_20261022_edges AS SELECT * FROM plot_edge_measurements WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
CREATE TABLE IF NOT EXISTS talib_before_36_20261022_admin AS SELECT * FROM plot_admin_details WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
CREATE TABLE IF NOT EXISTS talib_before_36_20261022_pricing AS SELECT * FROM plot_pricing WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
CREATE TABLE IF NOT EXISTS talib_before_36_20261022_geo AS SELECT * FROM geo_features WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
CREATE TABLE IF NOT EXISTS talib_before_36_20261022_settings AS SELECT * FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';

-- Old 33..37 business attributes -> new 32..36, on existing stable Plot IDs.
-- Old 32 commercial data cannot leak into new residential Plot 32.
UPDATE plots SET (sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2,dimension_unit,front_edge_index,depth_edge_index,back_edge_index,depth2_edge_index,front_label,depth_label,back_label,depth2_label,side_dimensions,edge_semantics,polygon,status,notes,featured,inventory_active) = (
  SELECT b.sqft,b.sqm,b.sqyd,b.dimensions,b.road,b.front,b.depth,b.back,b.depth2,b.dimension_unit,b.front_edge_index,b.depth_edge_index,b.back_edge_index,b.depth2_edge_index,b.front_label,b.depth_label,b.back_label,b.depth2_label,b.side_dimensions,b.edge_semantics,b.polygon,b.status,b.notes,b.featured,b.inventory_active FROM talib_before_36_20261022_plots b
  WHERE b.project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
  AND b.id=CAST(CAST(plots.id AS INTEGER)+1 AS TEXT)
), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id IN ('32','33','34','35','36');

-- All private detail records are explicitly protected by the fail-closed guard.
-- Empty placeholder details can be removed safely, preserving full original backups.
DELETE FROM plot_admin_details WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND plot_id IN ('32','33','34','35','36','37');
DELETE FROM plot_pricing WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND plot_id IN ('32','33','34','35','36','37');

-- Shift edge-measurement metadata by PHYSICAL plot, retaining lengths and labels.
DELETE FROM plot_edge_measurements WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND plot_id IN ('32','33','34','35','36','37');
INSERT INTO plot_edge_measurements(
  project_id,plot_id,role,segment_index,edge_index,point_count,length,unit,
  raw_label,road_frontage,road_access,source_ref,source_raw_text,
  confidence,verified,updated_at
)
SELECT project_id,CAST(CAST(plot_id AS INTEGER)-1 AS TEXT),
  role,segment_index,edge_index,point_count,length,unit,
  raw_label,road_frontage,road_access,source_ref,source_raw_text,
  confidence,verified,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM talib_before_36_20261022_edges
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND plot_id IN ('33','34','35','36','37');

-- Geo links reference physical plots. Commercial former 32 must not point to new 32.
UPDATE geo_features
SET linked_plot_id=CASE
    WHEN linked_plot_id='32' THEN NULL
    ELSE CAST(CAST(linked_plot_id AS INTEGER)-1 AS TEXT)
  END
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND linked_plot_id IN ('32','33','34','35','36','37');

-- Remap optional mapper-facing directions to new numbering.
UPDATE settings SET value=(
  SELECT COALESCE(json_group_object(
    CASE WHEN j.key IN ('33','34','35','36','37')
      THEN CAST(CAST(j.key AS INTEGER)-1 AS TEXT)
      ELSE j.key END,
    CASE LOWER(CAST(j.value AS TEXT))
      WHEN 'top' THEN 'left'
      WHEN 'right' THEN 'top'
      WHEN 'bottom' THEN 'right'
      WHEN 'left' THEN 'bottom'
      ELSE j.value END
  ),'{}')
  FROM json_each(settings.value) j WHERE j.key<>'32'
),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='plotFrontDirections'
  AND json_valid(value) AND json_type(value)='object';

-- Remove only old Plot 37 after its data is copied to Plot 36.
DELETE FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='37';

INSERT INTO settings(project_id,key,value,updated_at)
VALUES ('e94cec2c-e3f7-4a13-aa75-5ec4167baaf2','plotSheetCount','36',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(project_id,key) DO UPDATE SET value='36',updated_at=excluded.updated_at;
INSERT INTO settings(project_id,key,value,updated_at)
VALUES ('e94cec2c-e3f7-4a13-aa75-5ec4167baaf2','plotSheetName','TALIB_NAZAMI_ALAM_AR3D_36_PLOTS_FINAL.csv',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;

DROP TABLE IF EXISTS _talib_20261022_post_guard;
CREATE TABLE _talib_20261022_post_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _talib_20261022_post_guard(ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1)=36
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='37')=0
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='32' AND sqft BETWEEN 2741.20 AND 2741.30)=1
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='36' AND sqft BETWEEN 5730.48 AND 5730.58)=1
  AND (SELECT COUNT(*) FROM published_plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2')=37
  THEN 1 ELSE 0 END;
DROP TABLE _talib_20261022_guard;
DROP TABLE _talib_20261022_post_guard;
