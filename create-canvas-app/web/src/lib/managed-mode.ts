const MANAGED_MODE_KEY = "infinite-canvas:managed";

export function setManagedMode(enabled: boolean) {
    try {
        if (enabled) localStorage.setItem(MANAGED_MODE_KEY, "1");
        else localStorage.removeItem(MANAGED_MODE_KEY);
    } catch {
        // Local storage can be unavailable in hardened browser contexts.
    }
}

export function isManagedMode() {
    try {
        return localStorage.getItem(MANAGED_MODE_KEY) === "1";
    } catch {
        return false;
    }
}

export function publicAsset(path: string) {
    const base = import.meta.env.BASE_URL || "/";
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
