\set ON_ERROR_STOP on

-- The caller must pass -v muse_api_key=... and optionally
-- -v muse_base_url=https://momoapi.xin/v1.
\if :{?muse_api_key}
\else
\echo 'muse_api_key is required'
\quit 3
\endif

\if :{?muse_base_url}
\else
\set muse_base_url https://momoapi.xin/v1
\endif

BEGIN;

CREATE TEMP TABLE muse_seed_input ON COMMIT DROP AS
SELECT jsonb_build_object(
    'base_url', :'muse_base_url',
    'api_key', :'muse_api_key',
    'model_mapping', '{"muse-video":"muse-video","muse-cheap":"muse-cheap"}'::jsonb
) AS credentials;

INSERT INTO groups (
    name,
    description,
    platform,
    rate_multiplier,
    status,
    supported_model_scopes,
    sort_order,
    allow_image_generation,
    video_rate_independent,
    video_rate_multiplier,
    model_allowlist,
    model_pricing
)
SELECT
    'Muse 视频',
    'Muse text-to-video, image-to-video and reference-image video models',
    'composite',
    1.0,
    'active',
    '[]'::jsonb,
    100,
    true,
    false,
    1.0,
    '{"models":["muse-video","muse-cheap"],"enabled":false}'::jsonb,
    '[]'::jsonb
WHERE NOT EXISTS (
    SELECT 1
    FROM groups
    WHERE name = 'Muse 视频'
      AND deleted_at IS NULL
);

DO $$
DECLARE
    v_group_id bigint;
    v_account_id bigint;
    v_credentials jsonb;
BEGIN
    SELECT id
    INTO v_group_id
    FROM groups
    WHERE name = 'Muse 视频'
      AND deleted_at IS NULL
    ORDER BY id
    LIMIT 1;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Muse group was not created';
    END IF;

    SELECT credentials
    INTO v_credentials
    FROM muse_seed_input;

    SELECT id
    INTO v_account_id
    FROM accounts
    WHERE name = 'muse'
      AND platform = 'muse'
      AND deleted_at IS NULL
    ORDER BY id
    LIMIT 1;

    IF v_account_id IS NULL THEN
        INSERT INTO accounts (
            name,
            platform,
            type,
            credentials,
            extra,
            concurrency,
            priority,
            status,
            schedulable,
            notes,
            rate_multiplier
        )
        VALUES (
            'muse',
            'muse',
            'apikey',
            v_credentials,
            '{}'::jsonb,
            3,
            50,
            'active',
            true,
            'Muse video provider',
            1.0
        )
        RETURNING id INTO v_account_id;
    ELSE
        UPDATE accounts
        SET
            type = 'apikey',
            credentials = v_credentials,
            status = 'active',
            schedulable = true,
            notes = 'Muse video provider',
            updated_at = now()
        WHERE id = v_account_id;
    END IF;

    INSERT INTO account_groups (account_id, group_id, priority)
    VALUES (v_account_id, v_group_id, 1)
    ON CONFLICT (account_id, group_id)
    DO UPDATE SET priority = EXCLUDED.priority;
END
$$;

COMMIT;

SELECT
    a.id AS account_id,
    a.name AS account_name,
    g.id AS group_id,
    g.name AS group_name,
    a.status AS account_status,
    g.status AS group_status
FROM accounts a
JOIN account_groups ag ON ag.account_id = a.id
JOIN groups g ON g.id = ag.group_id
WHERE a.name = 'muse'
  AND a.platform = 'muse'
  AND a.deleted_at IS NULL
  AND g.name = 'Muse 视频'
  AND g.deleted_at IS NULL;
