CREATE TABLE IF NOT EXISTS usage_log_image_links (
    request_id VARCHAR(128) PRIMARY KEY,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
