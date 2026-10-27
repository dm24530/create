ALTER TABLE usage_log_image_links
    ADD COLUMN IF NOT EXISTS displayed_at TIMESTAMPTZ;

ALTER TABLE usage_log_image_links
    ADD COLUMN IF NOT EXISTS generation_duration_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_usage_log_image_links_displayed_at
    ON usage_log_image_links (displayed_at)
    WHERE displayed_at IS NOT NULL;
