import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { mapWithConcurrency } from "@/lib/concurrency";
import { withLocalProxy } from "@/stores/use-config-store";
import {
    legacyCanvasStorageKeys,
    scopedCanvasStorageKey,
    scopedCanvasStoreName,
    unscopedCanvasStorageKey,
} from "@/lib/canvas-storage-scope";
import {
    CANVAS_IMAGE_REQUEST_BUDGET_BYTES,
    CANVAS_IMAGE_REQUEST_POLICIES,
    CANVAS_IMAGE_REQUEST_POLICY_VERSION,
    createImageRequestBlob,
    createImageThumbnail,
    type ImageRequestPolicy,
} from "@/lib/image-thumbnail";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const previewStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_previews" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: scopedCanvasStoreName("image_generation_logs") });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: scopedCanvasStoreName("video_generation_logs") });
const objectUrls = new Map<string, string>();
const previewUrls = new Map<string, string>();
const requestImageCache = new Map<string, Promise<PreparedImageRequest>>();
const previewListeners = new Set<() => void>();
let previewRevision = 0;
let previewQueue: Promise<unknown> = Promise.resolve();
const IMAGE_PREVIEW_VERSION = 1;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_REMOTE_LOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";
const REQUEST_IMAGE_CACHE_LIMIT = 24;

type StoredImagePreview = { version: number; blob?: Blob };

type ImageReadOptions = { signal?: AbortSignal };
type ImageReferenceSource = { url?: string; dataUrl?: string; storageKey?: string };

export type PreparedImageRequest = {
    dataUrl: string;
    mimeType: string;
    bytes: number;
    sourceBytes: number;
    width: number;
    height: number;
    reencoded: boolean;
    policy: number;
};

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    if (typeof input !== "string") return storeImage(input, options);

    let blob: Blob;
    try {
        blob = await fetchImageBlob(input, options);
    } catch (error) {
        if (options?.signal?.aborted || isNamedError(error, IMAGE_RESPONSE_ERROR) || isNamedError(error, IMAGE_TIMEOUT_ERROR) || !/^https?:\/\//i.test(input)) throw error;
        const meta = await loadImageMeta(input, options, IMAGE_REMOTE_LOAD_TIMEOUT_MS);
        if (!meta) throw error;
        return { url: input, width: meta.width, height: meta.height, bytes: 0, mimeType: "" };
    }
    return storeImage(blob, options);
}

async function storeImage(blob: Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    try {
        const meta = await loadImageMeta(url, options);
        if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
        throwIfAborted(options?.signal);
        await store.setItem(scopedCanvasStorageKey(storageKey), blob);
        throwIfAborted(options?.signal);
        objectUrls.set(storageKey, url);
        queueImagePreview(storageKey);
        return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type.startsWith("image/") ? blob.type : "" };
    } catch (error) {
        URL.revokeObjectURL(url);
        await store.removeItem(scopedCanvasStorageKey(storageKey)).catch(() => undefined);
        throw error;
    }
}

async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function namedError(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
}

function isNamedError(error: unknown, name: string) {
    return error instanceof Error && error.name === name;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await getScopedBlob(store, storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return getScopedBlob(store, storageKey);
}

// 缩略图按图片的 storageKey 另存一份 WebP，只放在本地 IndexedDB 里，不写进节点数据，也不参与导出和 WebDAV 同步。
export function previewUrlFor(storageKey?: string) {
    return storageKey ? previewUrls.get(storageKey) : undefined;
}

// 缩略图在后台补，生成完成后再让用到它的界面重渲染一次。
export function subscribeImagePreviews(listener: () => void) {
    previewListeners.add(listener);
    return () => {
        previewListeners.delete(listener);
    };
}

export function getImagePreviewRevision() {
    return previewRevision;
}

export async function ensureImagePreview(storageKey?: string) {
    if (!storageKey) return undefined;
    const cached = previewUrls.get(storageKey);
    if (cached) return cached;
    const stored = await getScopedPreview(storageKey);
    if (stored?.version === IMAGE_PREVIEW_VERSION) return stored.blob ? cacheImagePreview(storageKey, stored.blob) : undefined;
    queueImagePreview(storageKey);
    return undefined;
}

// 缩略图生成排成一队，避免一次打开大量图片时同时解码。
function queueImagePreview(storageKey: string) {
    previewQueue = previewQueue
        .then(async () => {
            const original = await getImageBlob(storageKey);
            if (original) await storeImagePreview(storageKey, original);
        })
        .catch(() => undefined);
}

async function storeImagePreview(storageKey: string, original: Blob) {
    const preview = await createImageThumbnail(original).catch(() => undefined);
    await previewStore.setItem<StoredImagePreview>(
        scopedCanvasStorageKey(storageKey),
        { version: IMAGE_PREVIEW_VERSION, blob: preview },
    ).catch(() => undefined);
    return preview ? cacheImagePreview(storageKey, preview) : undefined;
}

function cacheImagePreview(storageKey: string, preview: Blob) {
    const url = URL.createObjectURL(preview);
    previewUrls.set(storageKey, url);
    previewRevision += 1;
    previewListeners.forEach((listener) => listener());
    return url;
}

async function deleteImagePreview(storageKey: string) {
    const url = previewUrls.get(storageKey);
    if (url) URL.revokeObjectURL(url);
    previewUrls.delete(storageKey);
    await previewStore.removeItem(scopedCanvasStorageKey(storageKey)).catch(() => undefined);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    clearRequestImageCache(storageKey);
    await store.setItem(scopedCanvasStorageKey(storageKey), blob);
    await deleteImagePreview(storageKey);
    await storeImagePreview(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await fetchImageBlob(url, options));
}

export async function prepareImageRequestDataUrls(images: readonly ImageReferenceSource[], options?: ImageReadOptions): Promise<PreparedImageRequest[]> {
    if (images.length === 0) return [];
    const blobs = await mapWithConcurrency(images, 2, async (image) => {
        const dataUrl = await imageToDataUrl(image, options);
        if (!dataUrl) throw new Error(i18n.t("apiErrors.referenceImageReadFailed"));
        return fetchImageBlob(dataUrl, options);
    });

    let smallestTotal = Number.POSITIVE_INFINITY;
    for (let policyIndex = 0; policyIndex < CANVAS_IMAGE_REQUEST_POLICIES.length; policyIndex += 1) {
        const policy = CANVAS_IMAGE_REQUEST_POLICIES[policyIndex];
        const prepared = await mapWithConcurrency(images, 2, (image, index) => prepareImageRequest(blobs[index], image, policy, policyIndex));
        const total = prepared.reduce((sum, image) => sum + image.dataUrl.length, 0);
        smallestTotal = Math.min(smallestTotal, total);
        if (total <= CANVAS_IMAGE_REQUEST_BUDGET_BYTES) return prepared;
    }

    const limit = `${Math.round(CANVAS_IMAGE_REQUEST_BUDGET_BYTES / 1024 / 1024)} MB`;
    const actual = `${Math.ceil(smallestTotal / 1024 / 1024)} MB`;
    throw new Error(i18n.language.toLowerCase().startsWith("zh")
        ? `参考图片总量为 ${actual}，超过 ${limit} 的安全上限，请减少参考图数量或使用更小的图片`
        : `Reference images total ${actual}, above the ${limit} safety limit. Use fewer or smaller images.`);
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            clearRequestImageCache(key);
            await deleteImagePreview(key);
            await store.removeItem(scopedCanvasStorageKey(key));
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        const storageKey = unscopedCanvasStorageKey(key);
        if (scopedCanvasStorageKey(storageKey) === key && !usedKeys.has(storageKey)) unused.push(storageKey);
    });
    const orphanPreviews: string[] = [];
    await previewStore.iterate((_value, key) => {
        const storageKey = unscopedCanvasStorageKey(key);
        if (scopedCanvasStorageKey(storageKey) === key && !usedKeys.has(storageKey)) orphanPreviews.push(storageKey);
    });
    await Promise.all([deleteStoredImages(unused), ...orphanPreviews.map(deleteImagePreview)]);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}

async function getScopedBlob(target: typeof store, key: string) {
    const scopedKey = scopedCanvasStorageKey(key);
    const scoped = await target.getItem<Blob>(scopedKey);
    if (scoped) {
        for (const legacyKey of legacyCanvasStorageKeys(key)) {
            await target.removeItem(legacyKey).catch(() => undefined);
        }
        return scoped;
    }
    for (const legacyKey of legacyCanvasStorageKeys(key)) {
        const legacy = await target.getItem<Blob>(legacyKey);
        if (legacy) {
            await target.setItem(scopedKey, legacy);
            await target.removeItem(legacyKey).catch(() => undefined);
            return legacy;
        }
    }
    return null;
}

async function getScopedPreview(key: string) {
    const scopedKey = scopedCanvasStorageKey(key);
    const scoped = await previewStore.getItem<StoredImagePreview>(scopedKey).catch(() => null);
    if (scoped) {
        for (const legacyKey of legacyCanvasStorageKeys(key)) {
            await previewStore.removeItem(legacyKey).catch(() => undefined);
        }
        return scoped;
    }
    for (const legacyKey of legacyCanvasStorageKeys(key)) {
        const legacy = await previewStore.getItem<StoredImagePreview>(legacyKey).catch(() => null);
        if (legacy) {
            await previewStore.setItem(scopedKey, legacy).catch(() => undefined);
            await previewStore.removeItem(legacyKey).catch(() => undefined);
            return legacy;
        }
    }
    return null;
}

async function prepareImageRequest(
    blob: Blob,
    source: ImageReferenceSource,
    policy: ImageRequestPolicy,
    policyIndex: number,
): Promise<PreparedImageRequest> {
    const sourceKey = imageRequestSourceKey(source);
    const cacheKey = sourceKey ? `${sourceKey}|${CANVAS_IMAGE_REQUEST_POLICY_VERSION}:${policyIndex}` : "";
    if (cacheKey) {
        const cached = requestImageCache.get(cacheKey);
        if (cached) return cached;
    }

    const pending = createImageRequestBlob(blob, policy).then(async (prepared) => {
        const dataUrl = await blobToDataUrl(prepared.blob);
        return {
            dataUrl,
            mimeType: prepared.blob.type || "image/png",
            bytes: estimateBase64Bytes(dataUrl),
            sourceBytes: blob.size,
            width: prepared.width,
            height: prepared.height,
            reencoded: prepared.reencoded,
            policy: policyIndex,
        };
    });
    if (!cacheKey) return pending;

    requestImageCache.set(cacheKey, pending);
    while (requestImageCache.size > REQUEST_IMAGE_CACHE_LIMIT) {
        const oldest = requestImageCache.keys().next().value;
        if (!oldest) break;
        requestImageCache.delete(oldest);
    }
    pending.catch(() => requestImageCache.delete(cacheKey));
    return pending;
}

function imageRequestSourceKey(image: ImageReferenceSource) {
    if (image.storageKey) return `storage:${image.storageKey}`;
    if (image.url && !/^(blob|data):/i.test(image.url)) return `url:${image.url}`;
    return "";
}

function clearRequestImageCache(storageKey: string) {
    const prefix = `storage:${storageKey}|`;
    for (const key of requestImageCache.keys()) {
        if (key.startsWith(prefix)) requestImageCache.delete(key);
    }
}

function estimateBase64Bytes(dataUrl: string) {
    const comma = dataUrl.indexOf(",");
    const encoded = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
    return Math.max(0, Math.floor((encoded * 3) / 4));
}
