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
