-- Opaque, stable storage namespace for every user.
-- Numeric user IDs remain internal and are never used in public object paths.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS storage_key VARCHAR(64);

UPDATE users
SET storage_key = replace(gen_random_uuid()::text, '-', '')
WHERE storage_key IS NULL OR storage_key = '';

ALTER TABLE users
    ALTER COLUMN storage_key SET NOT NULL,
    ALTER COLUMN storage_key SET DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_storage_key
    ON users (storage_key);

COMMENT ON COLUMN users.storage_key IS
    'Stable random user storage namespace used in object-storage paths';
