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
    // Images generated before account scoping were stored under the default
    // scope. Preserve those local records and migrate them on first access.
    if (canvasStorageScope === "default") keys.add(key);
    else keys.add(`scope:default:${key}`);
    keys.delete(scopedCanvasStorageKey(key));
    return [...keys];
}


const LEGACY_DATA_OWNER_KEY = "create-canvas:legacy-data-owner-user-id";

export function canCurrentUserClaimLegacyData() {
    if (typeof window === "undefined" || !userCandidate) return false;
    try {
        const owner = window.localStorage.getItem(LEGACY_DATA_OWNER_KEY) || "";
        if (!owner) {
            window.localStorage.setItem(LEGACY_DATA_OWNER_KEY, userCandidate);
            return true;
        }
        return owner === userCandidate;
    } catch {
        return false;
    }
}
export function scopedCanvasStoreName(name: string) {
    return `${name}:${canvasStorageScope}`;
}

