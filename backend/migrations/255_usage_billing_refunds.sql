-- Persist the monetary snapshot needed to refund a charged request exactly once.
ALTER TABLE usage_billing_dedup
    ADD COLUMN IF NOT EXISTS user_id BIGINT,
    ADD COLUMN IF NOT EXISTS request_instance_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS subscription_id BIGINT,
    ADD COLUMN IF NOT EXISTS balance_cost NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS subscription_cost NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS api_key_quota_cost NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS api_key_rate_limit_cost NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(20, 8) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_billing_dedup_refunded_at
    ON usage_billing_dedup (refunded_at)
    WHERE refunded_at IS NOT NULL;

-- Surface the refund outcome on failed-request records without storing sensitive billing details.
ALTER TABLE ops_error_logs
    ADD COLUMN IF NOT EXISTS refund_status VARCHAR(16) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ops_error_logs_refund_status_time
    ON ops_error_logs (refund_status, created_at DESC)
    WHERE refund_status <> 'none';
