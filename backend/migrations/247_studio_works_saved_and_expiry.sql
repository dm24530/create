-- 作品库分两档：
--   saved = TRUE  用户主动"存到我的作品"：长期有效，按配额（默认 100）计数
--   saved = FALSE 只是生成页的临时内容：到期（expires_at）后由后台清扫任务连对象一起删
--
-- 之前所有记录都是"永久"语义，所以要把既有数据标成已保存，
-- 否则第一次清扫会把它们当过期临时内容删掉。

ALTER TABLE studio_works
    ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE studio_works
SET saved = TRUE
WHERE saved = FALSE
  AND expires_at IS NULL;

-- 清扫只关心临时且到期的行，索引也按这个条件建。
CREATE INDEX IF NOT EXISTS idx_studio_works_expiry
    ON studio_works (expires_at)
    WHERE saved = FALSE;

-- 我的作品列表按 (user_id, saved) 过滤后按时间倒序取。
CREATE INDEX IF NOT EXISTS idx_studio_works_user_saved_created_at
    ON studio_works (user_id, saved, created_at DESC);

COMMENT ON COLUMN studio_works.saved IS '是否已存进「我的作品」：TRUE 长期有效并计入配额，FALSE 为生成页临时内容';
COMMENT ON COLUMN studio_works.expires_at IS '临时内容的过期时间；已保存的行恒为 NULL';
