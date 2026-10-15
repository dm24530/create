-- 用户作品库（图片工作台图库 + 视频工作台的「我的作品」）。
--
-- 之前这两类记录都存在 Redis 里并且带 TTL，到期索引就消失（文件还留在对象存储里，
-- 但用户再也找不到入口）。这里换成持久表，并额外记录 object_key：
-- 用户删除作品时，才能把对象存储里对应的文件一起删掉，避免桶里堆孤儿对象。
--
-- 配额约定：每人 100 个文件，图片与视频共用同一份计数（见 service 层常量）。

CREATE TABLE IF NOT EXISTS studio_works (
    id               VARCHAR(64)  PRIMARY KEY,
    user_id          BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             VARCHAR(16)  NOT NULL, -- image / video
    object_key       TEXT         NOT NULL,
    url              TEXT         NOT NULL DEFAULT '',
    prompt           TEXT         NOT NULL DEFAULT '',
    model            VARCHAR(128) NOT NULL DEFAULT '',
    format           VARCHAR(32)  NOT NULL DEFAULT '',
    size             VARCHAR(32)  NOT NULL DEFAULT '',
    duration_seconds INT          NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 列表按时间倒序取，配额计数按 user_id 汇总，两个索引分别覆盖这两条路径。
CREATE INDEX IF NOT EXISTS idx_studio_works_user_created_at ON studio_works (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_works_user_kind ON studio_works (user_id, kind);

COMMENT ON TABLE studio_works IS '用户作品库：图片与视频共表，按 user_id 计配额';
COMMENT ON COLUMN studio_works.kind IS '作品类型：image 或 video';
COMMENT ON COLUMN studio_works.object_key IS '对象存储里的完整键，删除作品时据此删对象';
