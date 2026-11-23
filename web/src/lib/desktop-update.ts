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

const SKIPPED_UPDATE_VERSION_KEY = "create.desktop.skippedUpdateVersion";

function normalizeVersion(value: string) {
    return String(value || "").trim().replace(/^v/i, "");
}

export function readSkippedUpdateVersion() {
    if (typeof localStorage === "undefined") return "";
    return normalizeVersion(localStorage.getItem(SKIPPED_UPDATE_VERSION_KEY) || "");
}

export function writeSkippedUpdateVersion(version: string) {
    if (typeof localStorage === "undefined") return;
    const normalized = normalizeVersion(version);
    if (!normalized) {
        localStorage.removeItem(SKIPPED_UPDATE_VERSION_KEY);
        return;
    }
    localStorage.setItem(SKIPPED_UPDATE_VERSION_KEY, normalized);
}

export function clearSkippedUpdateVersion() {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(SKIPPED_UPDATE_VERSION_KEY);
}

export function shouldAutoPromptForUpdate(
    state: Pick<DesktopUpdateState, "status" | "currentVersion" | "latestVersion">,
    skippedVersion: string,
    currentVersion: string,
) {
    if (state.status !== "available" && state.status !== "downloaded") return false;
    const latest = normalizeVersion(state.latestVersion);
    if (!latest) return false;
    if (latest === normalizeVersion(state.currentVersion || currentVersion)) return false;
    if (state.status === "downloaded") return true;
    return latest !== normalizeVersion(skippedVersion);
}
