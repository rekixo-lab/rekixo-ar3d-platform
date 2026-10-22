-- This recovery restores editor geometry only, never the published customer website.
-- Source: immutable published v2 snapshot, all 37 valid polygons. Destination:
-- new 36-plot draft, whose 36 polygons were confirmed empty after Clear All.
-- Both source/destination logical image planes are 4096x2304 at 90° display
-- rotation, so the saved normalized polygons are copied UNROTATED.
-- New render may shift perspective; VERIFY alignment before Publish Update.
DROP TABLE IF EXISTS _talib_polygon_rescue_guard;
CREATE TABLE _talib_polygon_rescue_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _talib_polygon_rescue_guard(ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM projects WHERE id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
   AND name='TALIB NAZAMI ALAM  PLOTING'
   AND slug='talib-nazami-alam-ploting-e94cec'
   AND status='active' AND public_status='published' AND publish_version=2)=1
  AND (SELECT COUNT(*) FROM project_public_snapshots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND publish_version=2)=1
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1)=36
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1
    AND CAST(id AS INTEGER) BETWEEN 1 AND 36 AND id=CAST(CAST(id AS INTEGER) AS TEXT))=36
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1
    AND TRIM(COALESCE(polygon,''))<>'')=0
  AND (SELECT COUNT(*) FROM published_plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2')=37
  AND (SELECT COUNT(*) FROM published_plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
    AND TRIM(COALESCE(polygon,''))<>''
    AND json_valid(polygon) AND json_array_length(polygon) BETWEEN 3 AND 80)=37
  AND (SELECT COUNT(*) FROM published_plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
    AND CAST(id AS INTEGER) BETWEEN 1 AND 37
    AND id=CAST(CAST(id AS INTEGER) AS TEXT))=37
  AND (SELECT COUNT(*) FROM published_plots p, json_each(p.polygon) v
    WHERE p.project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND (
      json_type(v.value)<>'array' OR json_array_length(v.value)<>2
      OR typeof(json_extract(v.value,'$[0]')) NOT IN ('integer','real')
      OR typeof(json_extract(v.value,'$[1]')) NOT IN ('integer','real')
      OR CAST(json_extract(v.value,'$[0]') AS REAL) NOT BETWEEN 0 AND 1
      OR CAST(json_extract(v.value,'$[1]') AS REAL) NOT BETWEEN 0 AND 1))=0
  AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='masterplanName')='1_2 - Photo.jpg.mapping.webp'
  AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapWidth')='4096'
  AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapHeight')='2304'
  AND (SELECT value FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='publicRotation')='1'
  AND (SELECT value FROM published_settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapWidth')='4096'
  AND (SELECT value FROM published_settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapHeight')='2304'
  AND (SELECT value FROM published_settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='publicRotation')='1'
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='32' AND sqft BETWEEN 2741.20 AND 2741.30)=1
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='36' AND sqft BETWEEN 5730.48 AND 5730.58)=1
  AND (SELECT COUNT(*) FROM settings WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND key='mapperPolygonRecoverySource')=0
THEN 1 ELSE 0 END;
-- Permanent scoped pre-recovery copies; no deletions or changes to shared tables.
CREATE TABLE IF NOT EXISTS talib_pre_polygon_restore_20261022_plots AS
SELECT * FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
CREATE TABLE IF NOT EXISTS talib_pre_polygon_restore_20261022_edges AS
SELECT * FROM plot_edge_measurements WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';

-- Only copy geometries, index bindings, and edge semantics.
-- Business attributes (areas, dimensions, road, price, booking, status) stay as-is.
UPDATE plots
SET polygon=(SELECT old.polygon FROM published_plots old WHERE old.project_id=plots.project_id AND old.id=CASE WHEN CAST(plots.id AS INTEGER)>=32 THEN CAST(CAST(plots.id AS INTEGER)+1 AS TEXT) ELSE plots.id END),
  front_edge_index=(SELECT old.front_edge_index FROM published_plots old WHERE old.project_id=plots.project_id AND old.id=CASE WHEN CAST(plots.id AS INTEGER)>=32 THEN CAST(CAST(plots.id AS INTEGER)+1 AS TEXT) ELSE plots.id END),
  back_edge_index=(SELECT old.back_edge_index FROM published_plots old WHERE old.project_id=plots.project_id AND old.id=CASE WHEN CAST(plots.id AS INTEGER)>=32 THEN CAST(CAST(plots.id AS INTEGER)+1 AS TEXT) ELSE plots.id END),
  depth_edge_index=(SELECT old.depth_edge_index FROM published_plots old WHERE old.project_id=plots.project_id AND old.id=CASE WHEN CAST(plots.id AS INTEGER)>=32 THEN CAST(CAST(plots.id AS INTEGER)+1 AS TEXT) ELSE plots.id END),
  depth2_edge_index=(SELECT old.depth2_edge_index FROM published_plots old WHERE old.project_id=plots.project_id AND old.id=CASE WHEN CAST(plots.id AS INTEGER)>=32 THEN CAST(CAST(plots.id AS INTEGER)+1 AS TEXT) ELSE plots.id END),
  edge_semantics=(SELECT old.edge_semantics FROM published_plots old WHERE old.project_id=plots.project_id AND old.id=CASE WHEN CAST(plots.id AS INTEGER)>=32 THEN CAST(CAST(plots.id AS INTEGER)+1 AS TEXT) ELSE plots.id END),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1
  AND id IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36')
  AND TRIM(COALESCE(polygon,''))='';

-- Rebind existing side-length records to recovered edges when published record
-- contains a role/segment binding, keeping the newer draft length/label intact.
UPDATE plot_edge_measurements
SET edge_index=COALESCE((
    SELECT published.edge_index FROM published_plot_edge_measurements published
    WHERE published.project_id=plot_edge_measurements.project_id
      AND published.plot_id=CASE WHEN CAST(plot_edge_measurements.plot_id AS INTEGER)>=32 THEN
        CAST(CAST(plot_edge_measurements.plot_id AS INTEGER)+1 AS TEXT)
        ELSE plot_edge_measurements.plot_id END
      AND published.role=plot_edge_measurements.role
      AND published.segment_index=plot_edge_measurements.segment_index
  ), edge_index),
  point_count=COALESCE((
    SELECT published.point_count FROM published_plot_edge_measurements published
    WHERE published.project_id=plot_edge_measurements.project_id
      AND published.plot_id=CASE WHEN CAST(plot_edge_measurements.plot_id AS INTEGER)>=32 THEN
        CAST(CAST(plot_edge_measurements.plot_id AS INTEGER)+1 AS TEXT)
        ELSE plot_edge_measurements.plot_id END
      AND published.role=plot_edge_measurements.role
      AND published.segment_index=plot_edge_measurements.segment_index
  ),point_count),
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
 AND plot_id IN ('1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36');

-- Mark provenance. Review is mandatory before voluntary Publish Update.
INSERT INTO settings(project_id,key,value,updated_at)
VALUES ('e94cec2c-e3f7-4a13-aa75-5ec4167baaf2','mapperPolygonRecoverySource','published-v2-37-to-36-editor-only-20261022',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

DROP TABLE IF EXISTS _talib_polygon_rescue_post_guard;
CREATE TABLE _talib_polygon_rescue_post_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _talib_polygon_rescue_post_guard(ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND inventory_active=1
    AND TRIM(COALESCE(polygon,''))<>'' AND json_valid(polygon)
    AND json_array_length(polygon) BETWEEN 3 AND 80)=36
  AND (SELECT COUNT(*) FROM plots d WHERE d.project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
    AND d.inventory_active=1 AND d.polygon<>(
      SELECT s.polygon FROM published_plots s WHERE s.project_id=d.project_id
        AND s.id=CASE WHEN CAST(d.id AS INTEGER)>=32 THEN
          CAST(CAST(d.id AS INTEGER)+1 AS TEXT) ELSE d.id END
    ))=0
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='37')=0
  AND (SELECT COUNT(*) FROM published_plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2')=37
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='32'
    AND sqft BETWEEN 2741.20 AND 2741.30)=1
  AND (SELECT COUNT(*) FROM plots WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2' AND id='36'
    AND sqft BETWEEN 5730.48 AND 5730.58)=1
THEN 1 ELSE 0 END;
DROP TABLE _talib_polygon_rescue_guard;
DROP TABLE _talib_polygon_rescue_post_guard;
