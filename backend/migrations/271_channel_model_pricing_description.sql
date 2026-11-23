-- Model Plaza display description configured on a channel pricing entry.
ALTER TABLE channel_model_pricing
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN channel_model_pricing.description IS '模型广场展示说明；空字符串表示不展示';
