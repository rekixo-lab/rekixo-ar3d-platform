-- REKIXO_GALLERY_AMENITIES_V1: existing images keep their gallery classification.
-- This is additive; no published image bytes, project mapping or snapshots are rewritten.
ALTER TABLE gallery ADD COLUMN category TEXT NOT NULL DEFAULT 'gallery' CHECK(category IN ('gallery','amenity'));
CREATE INDEX IF NOT EXISTS idx_gallery_project_category ON gallery(project_id,category,sort_order DESC);
