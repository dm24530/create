import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { autoSaveGeneratedFile, readGeneratedFileAsset } from "@/lib/desktop-save";
import { resolveGeneratedImageBlob } from "@/lib/generated-image-download";
import { ensureImagePreview, getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { GeneratedImage, ImageGenerationLog, ImageGenerationLogConfig } from "@/types/workbench";

export const MAX_IMAGE_WORKBENCH_LOGS = 100;

export async function readImageLogs(logStore: LocalForage, ensureMigrated: () => Promise<unknown>) {
    if (typeof window === "undefined") return [];
    try {
        await ensureMigrated();
        const values: ImageGenerationLog[] = [];
        await logStore.iterate<ImageGenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(async (stored) => {
            const log = await normalizeImageLog(stored);
            const changed = log.images.some((image, index) => {
                const previous = stored.images?.[index];
                return image.storageKey !== previous?.storageKey || image.localPath !== previous?.localPath;
            });
            if (changed) await logStore.setItem(log.id, serializeImageLog(log)).catch(() => undefined);
            return log;
        }));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

export async function pruneImageLogs(logStore: LocalForage, ensureMigrated: () => Promise<unknown>, maxLogs = MAX_IMAGE_WORKBENCH_LOGS) {
    await ensureMigrated();
    const logs: ImageGenerationLog[] = [];
    await logStore.iterate<ImageGenerationLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    if (logs.length <= maxLogs) return false;
    const removable = logs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, logs.length - maxLogs);
    if (!removable.length) return false;
    await Promise.all(removable.map((log) => logStore.removeItem(log.id)));
    return true;
}

export async function resolveStoredLogImage(image: GeneratedImage): Promise<GeneratedImage> {
    let storageKey = image.storageKey?.trim() || "";
    let localPath = image.localPath?.trim() || "";
    let blob = storageKey ? await getImageBlob(storageKey).catch(() => null) : null;

    if (!blob || !localPath) {
        const recovered = await readGeneratedFileAsset({
            kind: "image",
            path: localPath,
            filename: localPath.split(/[\\/]/).pop() || undefined,
            size: image.bytes,
            mimeType: image.mimeType,
        }).catch(() => null);
        if (recovered?.blob.size) {
            blob = recovered.blob;
            localPath = recovered.savePath || localPath;
        }
    }

    if (!blob && image.dataUrl && !image.dataUrl.startsWith("blob:")) {
        blob = await resolveGeneratedImageBlob({ dataUrl: image.dataUrl }).catch(() => null);
    }
    if (blob?.size && !localPath) {
        const saved = await autoSaveGeneratedFile(blob, "image", image.mimeType || blob.type || "image/png").catch(() => null);
        localPath = saved?.savePath || "";
    }
    if (blob && !storageKey) storageKey = `image:${nanoid()}`;
    if (blob && storageKey) await setImageBlob(storageKey, blob).catch(() => undefined);
    if (storageKey) {
        void ensureImagePreview(storageKey);
        const dataUrl = await resolveImageUrl(storageKey, "").catch(() => "");
        if (dataUrl) return { ...image, storageKey, ...(localPath ? { localPath } : {}), dataUrl };
    }
    if (blob) {
        return {
            ...image,
            ...(storageKey ? { storageKey } : {}),
            ...(localPath ? { localPath } : {}),
            dataUrl: URL.createObjectURL(blob),
            mimeType: blob.type || image.mimeType,
        };
    }

    const durableFallback = image.dataUrl && !image.dataUrl.startsWith("blob:") ? image.dataUrl : "";
    return { ...image, ...(storageKey ? { storageKey } : {}), ...(localPath ? { localPath } : {}), dataUrl: durableFallback };
}

export async function normalizeImageLog(log: Partial<ImageGenerationLog>): Promise<ImageGenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const images = await Promise.all((log.images || []).map((item) => resolveStoredLogImage(item)));
    const config = normalizeImageLogConfig(log);
    return {
        id: log.id || nanoid(),
        userId: log.userId || Number(useUserStore.getState().user?.id) || undefined,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        images,
        error: log.error,
    };
}

export function serializeImageLog(log: ImageGenerationLog): ImageGenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
    };
}

export function normalizeImageLogConfig(log: Partial<ImageGenerationLog>): ImageGenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

export function buildImageLog({
    id,
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
    error,
}: {
    id?: string;
    prompt: string;
    model: string;
    config: ImageGenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: ImageGenerationLog["status"];
    images: GeneratedImage[];
    error?: string;
}): ImageGenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        id: id || nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        error,
    };
}