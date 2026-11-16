import { saveAs } from "file-saver";

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
    saveGeneratedFile?: (payload: { kind: DesktopSaveKind; mimeType: string; filename: string; data: ArrayBuffer }) => Promise<{ savePath: string }>;
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

export async function saveGeneratedFile(blob: Blob, kind: DesktopSaveKind, mimeType: string, filename: string) {
    const bridge = getDesktopSaveBridge();
    if (bridge?.saveGeneratedFile) {
        await bridge.saveGeneratedFile({ kind, mimeType: blob.type || mimeType, filename, data: await blobToArrayBuffer(blob) });
        return true;
    }
    saveAs(blob, filename);
    return Boolean(bridge);
}

export async function autoSaveGeneratedFile(blob: Blob, kind: DesktopSaveKind, mimeType: string, date = new Date()) {
    const extension = generatedFileExtension(kind, mimeType);
    const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    return saveGeneratedFile(blob, kind, mimeType, `create-${kind}-${stamp}.${extension}`);
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error || new Error("Failed to read generated file"));
        reader.readAsArrayBuffer(blob);
    });
}

export function generatedFileExtension(kind: DesktopSaveKind, mimeType: string) {
    const type = String(mimeType || "").toLowerCase();
    if (kind === "image") {
        if (type.includes("jpeg")) return "jpg";
        if (type.includes("webp")) return "webp";
        if (type.includes("gif")) return "gif";
        return "png";
    }
    if (kind === "video") {
        if (type.includes("webm")) return "webm";
        if (type.includes("quicktime")) return "mov";
        return "mp4";
    }
    return "bin";
}
