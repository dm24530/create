function storedCreateUserCandidate() {
    if (typeof window === "undefined") return "";
    try {
        const user = JSON.parse(window.localStorage.getItem("create-canvas:user") || "null") as { id?: unknown } | null;
        const id = Number(user?.id);
        return Number.isFinite(id) && id > 0 ? String(id) : "";
    } catch {
        return "";
    }
}

const search = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
const scopeCandidate = search?.get("scope")?.trim() || "";
const userCandidate = search?.get("user")?.trim() || storedCreateUserCandidate();

export const canvasStorageScope = /^[A-Za-z0-9_-]{8,128}$/.test(scopeCandidate)
    ? scopeCandidate
    : /^[A-Za-z0-9_-]{1,64}$/.test(userCandidate)
      ? `legacy-user-${userCandidate}`
      : "default";

const scopedPrefix = `scope:${canvasStorageScope}:`;

export function scopedCanvasStorageKey(key: string) {
    return key.startsWith(scopedPrefix) ? key : `${scopedPrefix}${key}`;
}

export function unscopedCanvasStorageKey(key: string) {
    return key.startsWith(scopedPrefix) ? key.slice(scopedPrefix.length) : key;
}

export function legacyCanvasStorageKeys(key: string) {
    const keys = new Set<string>();
    if (userCandidate) {
        keys.add(`${key}:user:${userCandidate}`);
    }
    // Unscoped legacy data has no owner. Migrating it into a user scope can
    // let whichever account opens the canvas first claim another user's work.
    // Keep it only for the explicit non-user default scope.
    if (canvasStorageScope === "default") keys.add(key);
    keys.delete(scopedCanvasStorageKey(key));
    return [...keys];
}

export function scopedCanvasStoreName(name: string) {
    return `${name}:${canvasStorageScope}`;
}

