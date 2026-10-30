CREATE TABLE IF NOT EXISTS canvas_upload_intents (
    asset_id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
    node_id VARCHAR(128) NOT NULL DEFAULT '',
    kind VARCHAR(16) NOT NULL DEFAULT 'image',
    object_key TEXT NOT NULL,
    thumb_object_key TEXT NOT NULL DEFAULT '',
    bytes BIGINT NOT NULL,
    thumb_bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NOT NULL,
    thumb_mime_type VARCHAR(128) NOT NULL DEFAULT '',
    sha256 VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvas_upload_intents_user_expires
    ON canvas_upload_intents (user_id, expires_at);
