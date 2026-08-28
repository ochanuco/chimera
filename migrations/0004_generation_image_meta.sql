-- Persists image resolution + file size on the Generation row instead of
-- reading them from R2 on every page view. See docs/domain-model.md.

ALTER TABLE generations ADD COLUMN image_width INTEGER;
ALTER TABLE generations ADD COLUMN image_height INTEGER;
ALTER TABLE generations ADD COLUMN image_size INTEGER;
