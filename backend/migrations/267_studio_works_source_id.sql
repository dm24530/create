ALTER TABLE studio_works
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(160) NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_works_user_kind_source_id
    ON studio_works (user_id, kind, source_id)
    WHERE source_id <> '';

COMMENT ON COLUMN studio_works.source_id IS
    'Stable upstream generation identifier; makes video archive retries idempotent';
