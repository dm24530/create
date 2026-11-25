import { createRequest } from "@/services/create-api";
import type { CreateSession } from "@/services/create-auth";
import type { VideoCapabilityProfile } from "@/lib/video-model-profile";

export type CreateUsageLog = {
    id: number;
    request_id?: string | null;
    api_key_id: number;
    model: string;
    group_id?: number | null;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    total_cost?: number;
    actual_cost?: number;
    request_type?: string | null;
    stream?: boolean;
    billing_mode?: string | null;
    duration_ms?: number | null;
    first_token_ms?: number | null;
    image_count?: number;
    image_size?: string | null;
    image_generation_duration_ms?: number | null;
    image_url?: string | null;
    record_kind?: string;
    created_at: string;
    api_key?: { id: number; name?: string } | null;
    group?: { id: number; name?: string } | null;
};

export type CreateUsagePage = {
    items: CreateUsageLog[];
    total: number;
    page: number;
    page_size: number;
    pages: number;
};

export type CreateUsageStats = {
    total_requests: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    total_cost: number;
    total_actual_cost: number;
    average_duration_ms: number;
};

export type CreateUsageQuery = {
    apiKeyId?: number;
    model?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
};

function usageParams(query: CreateUsageQuery, includePagination = true) {
    const params = new URLSearchParams();
    if (includePagination) {
        params.set("page", String(query.page || 1));
        params.set("page_size", String(query.pageSize || 20));
        params.set("sort_by", "created_at");
        params.set("sort_order", "desc");
    }
    if (query.apiKeyId) params.set("api_key_id", String(query.apiKeyId));
    if (query.model?.trim()) params.set("model", query.model.trim());
    if (query.startDate) params.set("start_date", query.startDate);
    if (query.endDate) params.set("end_date", query.endDate);
    return params;
}

export function listCreateUsage(session: CreateSession, query: CreateUsageQuery = {}) {
    const params = usageParams(query);
    return createRequest<CreateUsagePage>(`/usage?${params.toString()}`, {
        accessToken: session.accessToken,
    });
}

export function getCreateUsageStats(session: CreateSession, query: CreateUsageQuery = {}) {
    const params = usageParams(query, false);
    return createRequest<CreateUsageStats>(`/usage/stats?${params.toString()}`, {
        accessToken: session.accessToken,
    });
}
export type CreateModelPricingInterval = {
    min_tokens?: number;
    max_tokens?: number | null;
    tier_label?: string;
    input_price?: number | null;
    output_price?: number | null;
    cache_write_price?: number | null;
    cache_write_1h_price?: number | null;
    cache_read_price?: number | null;
    input_multiplier?: number | null;
    output_multiplier?: number | null;
    cache_write_multiplier?: number | null;
    cache_read_multiplier?: number | null;
    per_request_price?: number | null;
};

export type CreateModelPricing = {
    billing_mode?: string;
    input_price?: number | null;
    output_price?: number | null;
    cache_write_price?: number | null;
    cache_write_1h_price?: number | null;
    cache_read_price?: number | null;
    image_input_price?: number | null;
    image_output_price?: number | null;
    per_request_price?: number | null;
    intervals?: CreateModelPricingInterval[] | null;
};

export type CreateModelPlazaModel = {
    name: string;
    platform: string;
    description?: string;
    pricing?: CreateModelPricing | null;
    official_pricing?: Record<string, unknown> | null;
    video_capabilities?: VideoCapabilityProfile | null;
};

export type CreateModelPlazaGroup = {
    id: number;
    name: string;
    description?: string;
    platform: string;
    subscription_type?: string;
    rate_multiplier: number;
    user_rate_multiplier?: number | null;
    peak_rate_enabled?: boolean;
    peak_start?: string;
    peak_end?: string;
    peak_rate_multiplier?: number;
    is_exclusive?: boolean;
    image_rate_independent?: boolean;
    image_rate_multiplier?: number | null;
    video_rate_independent?: boolean;
    video_rate_multiplier?: number | null;
    models: CreateModelPlazaModel[];
};

export type CreateModelPlaza = {
    description?: string;
    groups: CreateModelPlazaGroup[];
};

export type CreatePaymentMethod = {
    payment_type: string;
    currency: string;
    fee_rate: number;
    daily_limit: number;
    single_min: number;
    single_max: number;
};

export type CreateCheckoutInfo = {
    methods: Record<string, CreatePaymentMethod>;
    global_min: number;
    global_max: number;
    balance_disabled: boolean;
    balance_recharge_multiplier: number;
    recharge_fee_rate: number;
    recharge_bonus_notice?: string;
    recharge_card_enabled?: boolean;
    recharge_card_products?: Array<{ id: string; name: string; amount: number; price?: number; currency?: string }>;
};

export type CreatePaymentOrderResult = {
    order_id: number;
    amount: number;
    pay_amount: number;
    pay_url?: string;
    qr_code?: string;
    expires_at: string;
    payment_type?: string;
    out_trade_no?: string;
};

export async function getCreateModelPlaza(session: CreateSession) {
    return createRequest<CreateModelPlaza>("/model-plaza", { accessToken: session.accessToken });
}

export async function getCreateCheckoutInfo(session: CreateSession) {
    return createRequest<CreateCheckoutInfo>("/payment/checkout-info", { accessToken: session.accessToken });
}

export async function createCreatePaymentOrder(session: CreateSession, input: { amount: number; paymentType: string; orderType?: string }) {
    return createRequest<CreatePaymentOrderResult>("/payment/orders", {
        method: "POST",
        accessToken: session.accessToken,
        body: JSON.stringify({
            amount: input.amount,
            payment_type: input.paymentType,
            order_type: input.orderType || "balance",
        }),
    });
}

export type CreateRedeemResult = {
    message: string;
    type: string;
    value: number;
    new_balance?: number;
    new_concurrency?: number;
};

export async function redeemCreateCode(session: CreateSession, code: string) {
    return createRequest<CreateRedeemResult>("/redeem", {
        method: "POST",
        accessToken: session.accessToken,
        body: JSON.stringify({ code: code.trim() }),
    });
}
