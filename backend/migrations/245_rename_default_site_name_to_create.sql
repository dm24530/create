-- 品牌改名：把沿用上游默认值的站点名称一起换掉，用户自己填过的名字不动。
-- 145 已经把 sub2api 系列改成了 SuperAI，所以这里要同时覆盖两代默认值。
UPDATE settings
SET value = 'Create',
    updated_at = NOW()
WHERE key = 'site_name'
  AND lower(trim(value)) IN ('sub2api', 'sub2 api', 'sub2-api', 'superai');
