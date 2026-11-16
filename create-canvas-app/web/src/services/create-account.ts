import { createRequest } from "@/services/create-api";
import type { CreateSession } from "@/services/create-auth";

export type CreateUsageLog = {
    id: number;
    api_key_id: number;
    model: string;
    group_id?: number | null;
    input_tokens?: number;
    output_tokens?: number;
    total_cost?: number;
    actual_cost?: number;
    request_type?: string | null;
    stream?: boolean;
    duration_ms?: number | null;
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
    params.set("period", "today");
    return createRequest<CreateUsageStats>(`/usage/stats?${params.toString()}`, {
        accessToken: session.accessToken,
    });
}
