import localforage from "localforage";
import { nanoid } from "nanoid";

import { withLocalProxy } from "@/stores/use-config-store";
import {
    legacyCanvasStorageKeys,
    scopedCanvasStorageKey,
    scopedCanvasStoreName,
    unscopedCanvasStorageKey,
} from "@/lib/canvas-storage-scope";
import { safeCanvasMediaSource } from "@/lib/canvas/canvas-media-url";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: scopedCanvasStoreName("image_generation_logs") });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: scopedCanvasStoreName("video_generation_logs") });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const source = typeof input === "string" ? safeCanvasMediaSource(input) : "";
    if (typeof input === "string" && !source) throw new Error("unsupported media source");
    const blob = typeof input === "string" ? await (await fetch(withLocalProxy(source))).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    await store.setItem(scopedCanvasStorageKey(storageKey), blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await getScopedMediaBlob(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    return getScopedMediaBlob(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await store.setItem(scopedCanvasStorageKey(storageKey), blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(scopedCanvasStorageKey(key));
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectMediaStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectMediaStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        const storageKey = unscopedCanvasStorageKey(key);
        if (scopedCanvasStorageKey(storageKey) === key && !usedKeys.has(storageKey)) unused.push(storageKey);
    });
    await Promise.all(unused.map((key) => store.removeItem(scopedCanvasStorageKey(key))));
}

async function getScopedMediaBlob(storageKey: string) {
    const scopedKey = scopedCanvasStorageKey(storageKey);
    const scoped = await store.getItem<Blob>(scopedKey);
    if (scoped) {
        for (const legacyKey of legacyCanvasStorageKeys(storageKey)) {
            await store.removeItem(legacyKey).catch(() => undefined);
        }
        return scoped;
    }
    for (const legacyKey of legacyCanvasStorageKeys(storageKey)) {
        const legacy = await store.getItem<Blob>(legacyKey);
        if (legacy) {
            await store.setItem(scopedKey, legacy);
            await store.removeItem(legacyKey).catch(() => undefined);
            return legacy;
        }
    }
    return null;
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
