-- Older canvas graphs may contain raw object-storage URLs without a
-- corresponding canvas_assets row. Those URLs expire, while the object keys
-- remain valid. Backfill canvas_assets so the next API request can presign
-- fresh URLs and the canvas can recover old images.

WITH image_urls AS (
    SELECT
        p.user_id,
        p.id AS project_id,
        n->>'id' AS node_id,
        i->>'content' AS raw_url,
        regexp_replace(split_part(i->>'content', '?', 1), '^https?://[^/]+/images/', '') AS object_key
    FROM canvas_projects p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.graph->'nodes', '[]'::jsonb)) n
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n->'metadata'->'images', '[]'::jsonb)) i
    WHERE n->>'type' = 'image'
      AND COALESCE(i->>'content', '') ~ '^https?://'
      AND split_part(i->>'content', '?', 1) ~ '/images/(users|canvas)/'
)
INSERT INTO canvas_assets (
    id,
    user_id,
    project_id,
    node_id,
    kind,
    object_key,
    thumb_object_key,
    width,
    height,
    bytes,
    mime_type,
    sha256,
    created_at
)
SELECT
    md5(concat_ws(':', user_id::text, project_id, node_id, object_key)),
    user_id,
    project_id,
    node_id,
    'image',
    object_key,
    '',
    0,
    0,
    0,
    CASE
        WHEN lower(object_key) LIKE '%.png' THEN 'image/png'
        WHEN lower(object_key) LIKE '%.webp' THEN 'image/webp'
        WHEN lower(object_key) LIKE '%.gif' THEN 'image/gif'
        ELSE 'image/jpeg'
    END,
    '',
    NOW()
FROM image_urls
WHERE object_key <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM canvas_assets a
      WHERE a.project_id = image_urls.project_id
        AND a.node_id = image_urls.node_id
        AND a.object_key = image_urls.object_key
  )
ON CONFLICT (id) DO NOTHING;
