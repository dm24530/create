-- Repair canvas_assets rows created by an earlier 259 version that stripped
-- the object-store prefix from public URLs. The S3 key starts with images/ or
-- canvas/, so removing /images/ produced users/... and canvas/users/... keys
-- that could never be presigned from the bucket.

WITH repaired AS (
    SELECT
        a.id,
        regexp_replace(split_part(i->>'content', '?', 1), '^https?://[^/]+/', '') AS object_key
    FROM canvas_assets a
    JOIN canvas_projects p
      ON p.id = a.project_id
     AND p.user_id = a.user_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.graph->'nodes', '[]'::jsonb)) n
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n->'metadata'->'images', '[]'::jsonb)) i
    WHERE n->>'id' = a.node_id
      AND COALESCE(i->>'content', '') ~ '^https?://'
      AND split_part(i->>'content', '?', 1) ~ '^https?://[^/]+/(images|canvas)/'
      AND (
          a.object_key LIKE 'users/%'
          OR a.object_key LIKE 'canvas/users/%'
      )
)
UPDATE canvas_assets a
SET object_key = repaired.object_key
FROM repaired
WHERE a.id = repaired.id
  AND repaired.object_key <> ''
  AND repaired.object_key <> a.object_key;
