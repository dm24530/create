-- 图片生成成本价：仅用于管理员核算利润，不参与用户实际扣费。
-- image_price_1k/2k/4k 继续表示售价；以下字段表示对应分辨率的成本价。

ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_cost_price_1k DECIMAL(20,8);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_cost_price_2k DECIMAL(20,8);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_cost_price_4k DECIMAL(20,8);

COMMENT ON COLUMN groups.image_cost_price_1k IS '1K 分辨率图片生成成本价 (USD)，仅用于管理员利润核算';
COMMENT ON COLUMN groups.image_cost_price_2k IS '2K 分辨率图片生成成本价 (USD)，仅用于管理员利润核算';
COMMENT ON COLUMN groups.image_cost_price_4k IS '4K 分辨率图片生成成本价 (USD)，仅用于管理员利润核算';
