const DEFAULT_API_BASE_URL = "/api/v1";
const DEFAULT_GATEWAY_BASE_URL = "/v1";

function normalizeBaseUrl(value: unknown, fallback: string) {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    return raw.replace(/\/+$/, "");
}

export function isCreateProductMode() {
    return import.meta.env.VITE_CREATE_PRODUCT_MODE !== "0";
}

export function createApiBaseUrl() {
    return normalizeBaseUrl(import.meta.env.VITE_CREATE_API_BASE_URL, DEFAULT_API_BASE_URL);
}

export function createGatewayBaseUrl() {
    return normalizeBaseUrl(import.meta.env.VITE_CREATE_GATEWAY_BASE_URL, DEFAULT_GATEWAY_BASE_URL);
}

export function createApiUrl(path: string) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${createApiBaseUrl()}${normalizedPath}`;
}

export function createGatewayUrl(path: string) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${createGatewayBaseUrl()}${normalizedPath}`;
}

export function resolveCreateServiceUrl(value: string) {
    const raw = String(value || "").trim();
    if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
    const apiBase = createApiBaseUrl();
    if (!/^https?:\/\//i.test(apiBase) || !raw.startsWith("/")) return raw;
    return new URL(raw, new URL(apiBase).origin).toString();
}

export function createPublicMediaPath(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        const parsed = new URL(raw, "https://create.invalid");
        return parsed.pathname.startsWith("/api/v1/public/") ? `${parsed.pathname}${parsed.search}` : "";
    } catch {
        return "";
    }
}

export function isCreatePublicMediaUrl(value?: string | null) {
    return Boolean(createPublicMediaPath(value || ""));
}
