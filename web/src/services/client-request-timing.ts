export type ClientRequestTiming = {
    prepareMs: number;
    generationMs: number;
    downloadMs: number;
    totalMs: number;
};

export type ClientRequestPhaseInput = {
    prepareStartedAt: number;
    requestStartedAt: number;
    downloadStartedAt?: number | null;
    completedAt: number;
};

export function buildClientRequestTiming(input: ClientRequestPhaseInput): ClientRequestTiming {
    const prepareStartedAt = Number(input.prepareStartedAt) || 0;
    const requestStartedAt = Math.max(prepareStartedAt, Number(input.requestStartedAt) || prepareStartedAt);
    const completedAt = Math.max(requestStartedAt, Number(input.completedAt) || requestStartedAt);
    const requestedDownloadStart = Number(input.downloadStartedAt) || 0;
    const downloadStartedAt = requestedDownloadStart > 0
        ? Math.min(completedAt, Math.max(requestStartedAt, requestedDownloadStart))
        : completedAt;

    return {
        prepareMs: Math.max(0, Math.round(requestStartedAt - prepareStartedAt)),
        generationMs: Math.max(0, Math.round(downloadStartedAt - requestStartedAt)),
        downloadMs: Math.max(0, Math.round(completedAt - downloadStartedAt)),
        totalMs: Math.max(0, Math.round(completedAt - prepareStartedAt)),
    };
}

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
            downloadMs: Math.max(0, Math.round(timing.downloadMs || 0)),
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
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, Partial<ClientRequestTiming>>;
        if (!parsed || typeof parsed !== "object") return {};
        return Object.fromEntries(Object.entries(parsed).map(([id, timing]) => [id, {
            prepareMs: Math.max(0, Math.round(Number(timing?.prepareMs) || 0)),
            generationMs: Math.max(0, Math.round(Number(timing?.generationMs) || 0)),
            downloadMs: Math.max(0, Math.round(Number(timing?.downloadMs) || 0)),
            totalMs: Math.max(0, Math.round(Number(timing?.totalMs) || 0)),
        }]));
    } catch {
        return {};
    }
}
