-- The public image capability URL must not be derivable from user, API-key,
-- and request IDs. Regenerate every existing token with an opaque random value.
UPDATE usage_log_image_links
SET link_token = replace(gen_random_uuid()::text, '-', '');
