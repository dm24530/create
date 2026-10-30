ALTER TABLE canvas_assets
    ADD COLUMN IF NOT EXISTS source_object_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_assets_source_object_key
    ON canvas_assets (user_id, project_id, source_object_key)
    WHERE source_object_key <> '';
