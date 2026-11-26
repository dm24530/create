import type {
    CreateImagePerformanceModel,
    CreateVideoPerformanceMetric,
    CreateVideoPerformanceModel,
} from "@/services/create-account";

export type PerformanceBar = { key: string; rate: number | null };
export type PerformanceMetricSource = { series?: Array<{ bucket_start: string; success_rate: number | null }> | null };
export type PerformanceLevel = "good" | "warning" | "bad" | "none";

export function imagePerformanceKey(groupId: number, model: string) {
    return `${Number(groupId) || 0}::${normalizeModelName(model)}`;
}

export function normalizeModelName(model: string) {
    return model.trim().toLowerCase();
}

export function buildImagePerformanceMap(models: CreateImagePerformanceModel[] | null | undefined) {
    const map = new Map<string, CreateImagePerformanceModel>();
    for (const item of models || []) map.set(imagePerformanceKey(item.group_id, item.model), item);
    return map;
}

export function findImagePerformance(
    map: Map<string, CreateImagePerformanceModel> | null | undefined,
    groupId: number,
    model: string,
) {
    return map?.get(imagePerformanceKey(groupId, model)) || null;
}

export function buildVideoPerformanceMap(models: CreateVideoPerformanceModel[] | null | undefined) {
    const map = new Map<string, CreateVideoPerformanceModel>();
    for (const item of models || []) map.set(normalizeModelName(item.model), item);
    return map;
}

export function findVideoPerformance(
    map: Map<string, CreateVideoPerformanceModel> | null | undefined,
    model: string,
) {
    return map?.get(normalizeModelName(model)) || null;
}

export function buildPerformanceBars(
    metric: PerformanceMetricSource | null | undefined,
    endAt: string | undefined,
    now = new Date(),
): PerformanceBar[] {
    const series = Array.isArray(metric?.series) ? metric.series : [];
    const end = new Date(endAt || "");
    const anchor = Number.isFinite(end.getTime()) ? end : now;
    const cursor = new Date(anchor);
    cursor.setMinutes(0, 0, 0);
    const slots: string[] = [];
    for (let index = 23; index >= 0; index -= 1) {
        const slot = new Date(cursor);
        slot.setHours(cursor.getHours() - index);
        slots.push(slot.toISOString());
    }
    const buckets = new Map<string, { total: number; count: number }>();
    for (const point of series) {
        if (!point || point.success_rate == null) continue;
        const timestamp = new Date(point.bucket_start);
        if (!Number.isFinite(timestamp.getTime()) || !Number.isFinite(point.success_rate)) continue;
        timestamp.setMinutes(0, 0, 0);
        const key = timestamp.toISOString();
        const current = buckets.get(key) || { total: 0, count: 0 };
        current.total += point.success_rate;
        current.count += 1;
        buckets.set(key, current);
    }
    return slots.map((key) => {
        const bucket = buckets.get(key);
        return { key, rate: bucket && bucket.count ? bucket.total / bucket.count : null };
    });
}

export function performanceLevel(rate: number | null | undefined): PerformanceLevel {
    if (rate == null || !Number.isFinite(rate)) return "none";
    if (rate >= 0.7) return "good";
    if (rate >= 0.4) return "warning";
    return "bad";
}

export function performanceColor(level: PerformanceLevel) {
    if (level === "good") return "#10b981";
    if (level === "warning") return "#f59e0b";
    if (level === "bad") return "#f43f5e";
    return "#d6d3d1";
}

export function formatPerformanceRate(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return "—";
    return `${(value * 100).toFixed(value >= 0.995 ? 0 : 1)}%`;
}

export function formatPerformanceDuration(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value) || value <= 0) return "—";
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}s`;
}

export type VideoVendor = "seedance" | "minimax" | "grok" | "wan" | "muse" | "generic";

export function videoVendorKey(model: string): VideoVendor {
    const value = normalizeModelName(model);
    if (value.includes("seedance")) return "seedance";
    if (value.includes("minimax")) return "minimax";
    if (value.includes("grok")) return "grok";
    if (value.includes("wan3.0") || value.includes("wan-") || value.includes("wan ")) return "wan";
    if (value.includes("muse")) return "muse";
    return "generic";
}

export function videoVendorLabel(model: string) {
    const labels: Record<VideoVendor, string> = {
        seedance: "Seedance",
        minimax: "MiniMax",
        grok: "Grok",
        wan: "Wan",
        muse: "Muse",
        generic: "通用",
    };
    return labels[videoVendorKey(model)];
}