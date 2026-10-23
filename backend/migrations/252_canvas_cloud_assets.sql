CREATE TABLE IF NOT EXISTS canvas_projects (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL DEFAULT '',
    graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_updated_at
    ON canvas_projects (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS canvas_assets (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
    node_id VARCHAR(128) NOT NULL DEFAULT '',
    kind VARCHAR(16) NOT NULL DEFAULT 'image',
    object_key TEXT NOT NULL,
    thumb_object_key TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NOT NULL DEFAULT '',
    sha256 VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvas_assets_project
    ON canvas_assets (user_id, project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_canvas_assets_sha256
    ON canvas_assets (user_id, sha256)
    WHERE sha256 <> '';
