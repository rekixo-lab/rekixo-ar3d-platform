-- Correct only Plot 32 customer-facing side measurement text.
-- Keep every measurement and all geometry, pricing, status and other project data unchanged.

UPDATE plots
SET side_dimensions='Front 176''-9" · Back 198''-6" · Right 63''-9" · Sloping left 91''-4" · Upper 88''-3" · Road step 16''-0"'
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
  AND id='32'
  AND side_dimensions='User-confirmed Front 176''-9"; rear outer boundary 198''-6"; right boundary 63''-9"; sloping outer left boundary 91''-4"; upper boundary shared with plot31 88''-3"; road-junction step 16''-0".'
  AND EXISTS (
    SELECT 1 FROM projects
    WHERE id=plots.project_id
      AND slug='talib-nazami-alam-ploting-e94cec'
      AND name='TALIB NAZAMI ALAM  PLOTING'
      AND status='active'
  );

UPDATE published_plots
SET side_dimensions='Front 176''-9" · Back 198''-6" · Right 63''-9" · Sloping left 91''-4" · Upper 88''-3" · Road step 16''-0"'
WHERE project_id='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2'
  AND id='32'
  AND side_dimensions='User-confirmed Front 176''-9"; rear outer boundary 198''-6"; right boundary 63''-9"; sloping outer left boundary 91''-4"; upper boundary shared with plot31 88''-3"; road-junction step 16''-0".'
  AND EXISTS (
    SELECT 1 FROM projects
    WHERE id=published_plots.project_id
      AND slug='talib-nazami-alam-ploting-e94cec'
      AND name='TALIB NAZAMI ALAM  PLOTING'
      AND status='active'
  );
