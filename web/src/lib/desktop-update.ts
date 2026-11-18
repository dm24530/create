import { createApiUrl } from "@/lib/create-product";

export type DesktopUpdateStatus =
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";

export interface DesktopUpdateProgress {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
}

export interface DesktopUpdateState {
    status: DesktopUpdateStatus;
    currentVersion: string;
    latestVersion: string;
    notes: string;
    publishedAt: string;
    minimumVersion: string;
    updateBaseUrl: string;
    progress: DesktopUpdateProgress | null;
    error: string;
}

export interface DesktopUpdateBridge {
    isDesktop?: boolean;
    checkForUpdates: (metadataUrl: string) => Promise<DesktopUpdateState>;
    downloadUpdate: () => Promise<boolean>;
    installUpdate: () => Promise<boolean>;
    getUpdateState: () => Promise<DesktopUpdateState | null>;
    onUpdateEvent: (callback: (state: DesktopUpdateState) => void) => () => void;
    getSkippedUpdateVersion?: () => Promise<string>;
    setSkippedUpdateVersion?: (version: string) => Promise<boolean>;
    clearSkippedUpdateVersion?: () => Promise<boolean>;
}

export const UPDATE_CHECK_THROTTLE_MS = 60 * 1000;
export const SKIPPED_UPDATE_VERSION_KEY = "create-canvas:skipped-update-version";

export function normalizeUpdateVersion(value: unknown) {
    return String(value || "").trim().replace(/^v/i, "");
}

export function readSkippedUpdateVersion() {
    if (typeof window === "undefined") return "";
    try {
        return normalizeUpdateVersion(window.localStorage.getItem(SKIPPED_UPDATE_VERSION_KEY));
    } catch {
        return "";
    }
}

export function writeSkippedUpdateVersion(version: string) {
    if (typeof window === "undefined") return "";
    const normalized = normalizeUpdateVersion(version);
    try {
        if (normalized) window.localStorage.setItem(SKIPPED_UPDATE_VERSION_KEY, normalized);
        else window.localStorage.removeItem(SKIPPED_UPDATE_VERSION_KEY);
    } catch {
        // A hardened webview can reject storage access; the in-memory hook state still applies.
    }
    return normalized;
}

export function clearSkippedUpdateVersion() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(SKIPPED_UPDATE_VERSION_KEY);
    } catch {
        // Ignore storage failures and let the caller reset its in-memory state.
    }
}

export function shouldAutoPromptForUpdate(
    state: Pick<DesktopUpdateState, "status" | "latestVersion">,
    skippedVersion: string,
    promptedVersion: string,
) {
    const latestVersion = normalizeUpdateVersion(state.latestVersion);
    if (!latestVersion || normalizeUpdateVersion(promptedVersion) === latestVersion) return false;
    if (state.status === "downloaded") return true;
    if (state.status !== "available") return false;
    return normalizeUpdateVersion(skippedVersion) !== latestVersion;
}

export function getDesktopUpdateBridge(): DesktopUpdateBridge | null {
    if (typeof window === "undefined") return null;
    const bridge = (window as Window & { createDesktop?: Partial<DesktopUpdateBridge> }).createDesktop;
    if (!bridge || typeof bridge.checkForUpdates !== "function") return null;
    return bridge as DesktopUpdateBridge;
}

export function desktopUpdateMetadataUrl() {
    return createApiUrl("/public/create-client-release");
}
