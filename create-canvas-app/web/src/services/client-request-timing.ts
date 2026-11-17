export type ClientRequestTiming = {
    prepareMs: number;
    generationMs: number;
    totalMs: number;
};

const STORAGE_KEY = "create-canvas:client-request-timings";
const MAX_ENTRIES = 300;

export function saveClientRequestTiming(requestId: string, timing: ClientRequestTiming) {
    const id = requestId.trim();
    if (!id) return;
    try {
        const current = readTimings();
        const normalized = {
            prepareMs: Math.max(0, Math.round(timing.prepareMs)),
            generationMs: Math.max(0, Math.round(timing.generationMs)),
            totalMs: Math.max(0, Math.round(timing.totalMs)),
        };
        current[id] = normalized;
        if (!id.startsWith("client:")) current[`client:${id}`] = normalized;
        const entries = Object.entries(current).slice(-MAX_ENTRIES);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Timing diagnostics are best effort and must never break generation.
    }
}

export function getClientRequestTiming(requestId?: string | null): ClientRequestTiming | null {
    const id = String(requestId || "").trim();
    if (!id) return null;
    const timings = readTimings();
    return timings[id] || timings[id.startsWith("client:") ? id : `client:${id}`] || null;
}

function readTimings(): Record<string, ClientRequestTiming> {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, ClientRequestTiming>;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}
