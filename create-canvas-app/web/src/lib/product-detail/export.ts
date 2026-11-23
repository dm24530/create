import { unzipSync, zipSync } from "fflate";

import type { PageSpec, ProductDetailPlatformProfile } from "@/types/product-detail";

export function planSliceRanges(totalHeight: number, maxHeight: number) {
    const safeMax = Math.max(1, Math.floor(maxHeight));
    const ranges: Array<{ y: number; height: number }> = [];
    for (let y = 0; y < totalHeight; y += safeMax) ranges.push({ y, height: Math.min(safeMax, totalHeight - y) });
    return ranges;
}

export function buildExportManifest(projectId: string, productName: string, pages: PageSpec[]) {
    return {
        projectId,
        productName,
        generatedAt: new Date().toISOString(),
        pageCount: pages.length,
        totalHeight: pages.reduce((sum, page) => sum + page.height, 0),
        pages: pages.map((page) => ({
            pageId: page.pageId,
            width: page.width,
            height: page.height,
            overflowStatus: page.overflowStatus,
            validation: page.validation,
        })),
    };
}

export function createZipBlob(files: Record<string, Uint8Array>): Blob {
    return new Blob([zipSync(files)], { type: "application/zip" });
}

export function bytesFromBlob(blob: Blob): Promise<Uint8Array> {
    return readBlobBytes(blob);
}

export function profileMimeType(profile: ProductDetailPlatformProfile) {
    return profile.format === "png" ? "image/png" : "image/jpeg";
}

export function profileFileExtension(profile: ProductDetailPlatformProfile) {
    return profile.format === "png" ? "png" : "jpg";
}

export async function encodeCanvasForPlatform(canvas: HTMLCanvasElement, profile: ProductDetailPlatformProfile): Promise<Blob> {
    const mimeType = profileMimeType(profile);
    const qualities = profile.format === "jpeg" ? [0.94, 0.88, 0.82, 0.76] : [undefined];
    let smallest = 0;
    for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, mimeType, quality);
        smallest = smallest ? Math.min(smallest, blob.size) : blob.size;
        if (blob.size <= profile.maxFileSizeBytes) return blob;
    }
    throw new Error(`单页图片约 ${formatBytes(smallest)}，超过 ${profile.label} 的 ${formatBytes(profile.maxFileSizeBytes)} 限制。请缩短文案或减少页面内容。`);
}

export async function verifyExportedZip(blob: Blob, expectedFiles: string[]) {
    const data = await readBlobBytes(blob);
    const entries = unzipSync(data);
    const missing = expectedFiles.filter((path) => !entries[path] || entries[path].length === 0);
    if (missing.length) throw new Error(`导出文件校验失败，缺少：${missing.slice(0, 5).join("、")}`);
    return { entryCount: Object.keys(entries).length, totalBytes: data.byteLength };
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
    if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    if (typeof FileReader !== "undefined") {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.onerror = () => reject(reader.error || new Error("读取导出文件失败"));
            reader.readAsArrayBuffer(blob);
        });
    }
    return Promise.reject(new Error("当前环境不支持读取导出文件"));
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("页面编码失败")), mimeType, quality);
    });
}

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}