ALTER TABLE studio_works
    ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0;

-- Existing works keep a deterministic order derived from their creation time.
UPDATE studio_works
SET sort_order = FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT
WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_studio_works_user_kind_sort_order
    ON studio_works (user_id, kind, sort_order DESC, created_at DESC);

COMMENT ON COLUMN studio_works.sort_order IS
    'Client batch slot order. Larger values are newer; preserves positions after refresh and across devices.';
