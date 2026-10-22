-- Infinite canvas projects.
--
-- The graph is stored as JSONB because nodes, edges, viewport and future
-- node-specific metadata evolve together and are always read/written as one
-- document. The integer version enables optimistic locking across tabs.

CREATE TABLE IF NOT EXISTS canvas_projects (
    id         VARCHAR(64) PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL DEFAULT '',
    graph      JSONB       NOT NULL DEFAULT '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
    version    INTEGER     NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_updated_at
    ON canvas_projects (user_id, updated_at DESC);

COMMENT ON TABLE canvas_projects IS '无限画布项目；graph 保存节点、连线和视口';
COMMENT ON COLUMN canvas_projects.version IS '乐观锁版本号；每次保存递增';
