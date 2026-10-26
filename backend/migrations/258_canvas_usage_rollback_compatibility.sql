-- Keep the retired billing tables available for short-term binary rollback.
-- Application code no longer reads or writes them.
CREATE TABLE IF NOT EXISTS canvas_usage_plans (
    user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    package_name VARCHAR(64) NOT NULL DEFAULT '无限画布体验套餐',
    total_count  INTEGER NOT NULL DEFAULT 200 CHECK (total_count >= 0),
    used_count   INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (used_count <= total_count)
);

CREATE TABLE IF NOT EXISTS canvas_usage_reservations (
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_id       VARCHAR(128) NOT NULL,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    committed_count INTEGER NOT NULL DEFAULT 0 CHECK (committed_count >= 0),
    status          VARCHAR(16) NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'finalized', 'expired')),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, action_id),
    CHECK (committed_count <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_canvas_usage_reservations_active
    ON canvas_usage_reservations (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_canvas_usage_reservations_cleanup
    ON canvas_usage_reservations (user_id, updated_at)
    WHERE status IN ('expired', 'finalized');

COMMENT ON TABLE canvas_usage_plans IS
    'Deprecated rollback-compatibility table; canvas billing is disabled';
COMMENT ON TABLE canvas_usage_reservations IS
    'Deprecated rollback-compatibility table; canvas billing is disabled';
