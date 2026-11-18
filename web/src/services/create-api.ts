import { createApiUrl } from "@/lib/create-product";

export class CreateApiError extends Error {
    readonly status: number;
    readonly code: string | number | null;
    readonly reason?: string;

    constructor(message: string, options: { status?: number; code?: string | number | null; reason?: string } = {}) {
        super(message);
        this.name = "CreateApiError";
        this.status = options.status || 0;
        this.code = options.code ?? null;
        this.reason = options.reason;
    }
}

type ApiEnvelope<T> = {
    code: number | string;
    message?: string;
    reason?: string;
    data?: T;
};

export type CreateRequestOptions = RequestInit & {
    accessToken?: string;
    timeoutMs?: number;
};

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
    return Boolean(value && typeof value === "object" && "code" in value);
}

function responseMessage(payload: unknown, fallback: string) {
    if (!payload || typeof payload !== "object") return fallback;
    const record = payload as Record<string, unknown>;
    return String(record.message || record.error || record.reason || fallback);
}

export async function createRequest<T>(path: string, options: CreateRequestOptions = {}): Promise<T> {
    const { accessToken, headers, timeoutMs, signal: callerSignal, ...init } = options;
    const requestHeaders = new Headers(headers);
    if (accessToken) requestHeaders.set("Authorization", `Bearer ${accessToken}`);
    if (init.body && !(init.body instanceof FormData) && !requestHeaders.has("Content-Type")) {
        requestHeaders.set("Content-Type", "application/json");
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let timeoutController: AbortController | undefined;
    const abortFromCaller = () => timeoutController?.abort(callerSignal?.reason);
    if (timeoutMs && timeoutMs > 0) {
        timeoutController = new AbortController();
        if (callerSignal?.aborted) abortFromCaller();
        else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
        timeoutId = setTimeout(() => {
            timedOut = true;
            timeoutController?.abort(new DOMException("Request timed out", "TimeoutError"));
        }, timeoutMs);
    }

    let response: Response;
    try {
        response = await fetch(/^https?:\/\//i.test(path) ? path : createApiUrl(path), {
            ...init,
            credentials: "include",
            headers: requestHeaders,
            signal: timeoutController?.signal || callerSignal,
        });
    } catch (error) {
        if (timedOut) {
            throw new CreateApiError("请求超时，请检查网络或服务器状态后重试");
        }
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        callerSignal?.removeEventListener("abort", abortFromCaller);
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = text;
        }
    }

    if (!response.ok) {
        const envelope = isEnvelope(payload) ? payload : null;
        throw new CreateApiError(responseMessage(payload, `HTTP ${response.status}`), {
            status: response.status,
            code: envelope?.code ?? null,
            reason: envelope?.reason,
        });
    }

    if (isEnvelope(payload)) {
        if (String(payload.code) !== "0") {
            throw new CreateApiError(payload.message || "Create API request failed", {
                status: response.status,
                code: payload.code,
                reason: payload.reason,
            });
        }
        return payload.data as T;
    }

    return payload as T;
}
