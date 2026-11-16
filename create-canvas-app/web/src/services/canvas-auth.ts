let accessToken = "";
const listeners = new Set<() => void>();

export function configureCanvasAuth(token?: string) {
    const nextAccessToken = token?.trim() || "";
    if (nextAccessToken === accessToken) return;
    accessToken = nextAccessToken;
    listeners.forEach((listener) => listener());
}

export function getCanvasAccessToken() {
    return accessToken;
}

export function subscribeCanvasAuth(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function isCanvasAuthReady() {
    return Boolean(accessToken);
}
