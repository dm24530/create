CREATE TABLE IF NOT EXISTS image_generation_metrics (
    user_id BIGINT NOT NULL,
    api_key_id BIGINT NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    task_id VARCHAR(128),
    generation_duration_ms INTEGER NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, api_key_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_image_generation_metrics_completed_at
    ON image_generation_metrics (completed_at DESC);
