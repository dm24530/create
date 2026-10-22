-- Legacy rows were keyed only by request_id and cannot be attributed safely.
DELETE FROM usage_log_image_links;

ALTER TABLE usage_log_image_links
    DROP CONSTRAINT IF EXISTS usage_log_image_links_pkey,
    ADD COLUMN IF NOT EXISTS user_id BIGINT NOT NULL,
    ADD COLUMN IF NOT EXISTS api_key_id BIGINT NOT NULL,
    ADD COLUMN IF NOT EXISTS object_key TEXT,
    ADD COLUMN IF NOT EXISTS link_token VARCHAR(64) NOT NULL,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
    ADD CONSTRAINT usage_log_image_links_pkey PRIMARY KEY (user_id, api_key_id, request_id),
    ADD CONSTRAINT usage_log_image_links_link_token_key UNIQUE (link_token);

CREATE INDEX IF NOT EXISTS idx_usage_log_image_links_expires_at
    ON usage_log_image_links (expires_at);
