ALTER TABLE studio_works
    ADD COLUMN IF NOT EXISTS thumb_object_key TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN studio_works.thumb_object_key IS
    'Object key for the generated thumbnail; used to refresh signed thumbnail URLs.';
