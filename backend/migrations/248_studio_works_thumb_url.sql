ALTER TABLE studio_works
    ADD COLUMN IF NOT EXISTS thumb_url TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN studio_works.thumb_url IS '图片列表使用的 CDN 缩略图地址；视频为空';
