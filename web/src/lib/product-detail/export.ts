import { zipSync } from "fflate";
import type { PageSpec } from "@/types/product-detail";
export function planSliceRanges(totalHeight: number, maxHeight: number) { const safeMax = Math.max(1, Math.floor(maxHeight)); const ranges: Array<{ y: number; height: number }> = []; for (let y = 0; y < totalHeight; y += safeMax) ranges.push({ y, height: Math.min(safeMax, totalHeight - y) }); return ranges; }
export function buildExportManifest(projectId: string, productName: string, pages: PageSpec[]) { return { projectId, productName, generatedAt: new Date().toISOString(), pageCount: pages.length, totalHeight: pages.reduce((sum, page) => sum + page.height, 0), pages: pages.map((page) => ({ pageId: page.pageId, width: page.width, height: page.height })) }; }
export function createZipBlob(files: Record<string, Uint8Array>): Blob { return new Blob([zipSync(files)], { type: "application/zip" }); }
export function bytesFromBlob(blob: Blob): Promise<Uint8Array> { return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer)); }
