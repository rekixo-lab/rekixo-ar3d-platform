-- Refresh cached structural data for this corrected project only, without
-- republishing draft content or changing immutable masterplan/logo assets.
INSERT INTO published_settings(project_id,key,value)
SELECT p.id,'publicDataRevision','plot32-text-v1'
FROM projects p
WHERE p.id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
  AND p.slug='talib-nazami-alam-ploting-e94cec'
  AND p.name='TALIB NAZAMI ALAM  PLOTING'
  AND p.status='active'
  AND EXISTS (
    SELECT 1 FROM published_plots x
    WHERE x.project_id=p.id AND x.id='32'
      AND x.side_dimensions='Front 176''-9" · Back 198''-6" · Right 63''-9" · Sloping left 91''-4" · Upper 88''-3" · Road step 16''-0"'
  )
ON CONFLICT(project_id,key) DO NOTHING;
