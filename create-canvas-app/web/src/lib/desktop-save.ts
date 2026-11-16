export type LocalSaveSettings = {
    settingsVersion: number;
    imageDir: string;
    videoDir: string;
    otherDir: string;
    openFolderAfterSave: boolean;
};

export type DesktopSaveKind = "image" | "video" | "other";

type DesktopSaveBridge = {
    isDesktop: true;
    getSaveSettings: () => Promise<LocalSaveSettings>;
    saveSaveSettings: (settings: LocalSaveSettings) => Promise<LocalSaveSettings>;
    chooseSaveDirectory: (kind: DesktopSaveKind) => Promise<string | null>;
    openSaveFolder: (kind: DesktopSaveKind) => Promise<void>;
    onOpenSaveSettings: (callback: () => void) => () => void;
};

export function getDesktopSaveBridge(): DesktopSaveBridge | null {
    if (typeof window === "undefined") return null;
    const bridge = (window as Window & { createDesktop?: Partial<DesktopSaveBridge> }).createDesktop;
    if (!bridge?.isDesktop || !bridge.getSaveSettings || !bridge.saveSaveSettings || !bridge.chooseSaveDirectory || !bridge.openSaveFolder) return null;
    return bridge as DesktopSaveBridge;
}
