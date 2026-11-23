import type { PageSpec, PageLayer } from "@/types/product-detail";

export type CanvasImageLoader = (assetId: string) => Promise<CanvasImageSource | null>;

export async function renderPageToCanvas(spec: PageSpec, imageLoader: CanvasImageLoader): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas"); canvas.width = spec.width; canvas.height = spec.height;
    const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("当前设备不支持 Canvas 渲染");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = spec.background; context.fillRect(0, 0, spec.width, spec.height);
    for (const layer of spec.layers) {
        if (layer.type === "image") { const image = await imageLoader(layer.assetId); if (image) { if (layer.fit === "contain") drawImageContain(context, image, layer.rect.x, layer.rect.y, layer.rect.width, layer.rect.height); else drawImageCover(context, image, layer.rect.x, layer.rect.y, layer.rect.width, layer.rect.height); } }
        else if (layer.type === "gradient") { const gradient = context.createLinearGradient(0, layer.rect.y, 0, layer.rect.y + layer.rect.height); gradient.addColorStop(0, layer.colors[0] || "rgba(0,0,0,0)"); gradient.addColorStop(1, layer.colors[1] || "rgba(0,0,0,0.7)"); context.fillStyle = gradient; context.fillRect(layer.rect.x, layer.rect.y, layer.rect.width, layer.rect.height); }
        else if (layer.type === "shape") { context.fillStyle = layer.fill; roundedRect(context, layer.rect.x, layer.rect.y, layer.rect.width, layer.rect.height, layer.radius); context.fill(); }
        else drawTextLayer(context, layer);
    }
    return canvas;
}

export function stitchLongImage(canvases: HTMLCanvasElement[]): HTMLCanvasElement {
    if (!canvases.length) throw new Error("没有可拼接的页面");
    const width = Math.max(...canvases.map((canvas) => canvas.width)); const height = canvases.reduce((sum, canvas) => sum + canvas.height, 0);
    const result = document.createElement("canvas"); result.width = width; result.height = height;
    const context = result.getContext("2d"); if (!context) throw new Error("当前设备不支持 Canvas 拼接");
    let y = 0; for (const canvas of canvases) { context.drawImage(canvas, 0, y); y += canvas.height; } return result;
}

export function sliceLongImage(canvas: HTMLCanvasElement, maxHeight: number): HTMLCanvasElement[] {
    const slices: HTMLCanvasElement[] = [];
    for (const range of planRanges(canvas.height, maxHeight)) { const slice = document.createElement("canvas"); slice.width = canvas.width; slice.height = range.height; slice.getContext("2d")?.drawImage(canvas, 0, range.y, canvas.width, range.height, 0, 0, canvas.width, range.height); slices.push(slice); }
    return slices;
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType = "image/jpeg", quality = 0.92): Promise<Blob> { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("页面导出失败")), mimeType, quality)); }
function planRanges(total: number, maxHeight: number) { const safeMax = Math.max(1, Math.floor(maxHeight)); const ranges: Array<{ y: number; height: number }> = []; for (let y = 0; y < total; y += safeMax) ranges.push({ y, height: Math.min(safeMax, total - y) }); return ranges; }
function drawImageCover(context: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, width: number, height: number) { const sourceWidth = "width" in image ? Number(image.width) : width; const sourceHeight = "height" in image ? Number(image.height) : height; const scale = Math.max(width / sourceWidth, height / sourceHeight); const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale; context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip(); context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight); context.restore(); }
function drawImageContain(context: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, width: number, height: number) { const sourceWidth = "width" in image ? Number(image.width) : width; const sourceHeight = "height" in image ? Number(image.height) : height; const scale = Math.min(width / sourceWidth, height / sourceHeight); const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale; context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight); }
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) { const r = Math.min(radius, width / 2, height / 2); context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath(); }
function drawTextLayer(context: CanvasRenderingContext2D, layer: Extract<PageLayer, { type: "text" }>) { const style = layer.style; context.fillStyle = style.color; context.textAlign = style.align; context.textBaseline = "top"; context.font = `${normalizeFontWeight(style.fontWeight)} ${Math.round(style.fontSize)}px ${style.fontFamily}`; const lines = wrapText(context, layer.text, layer.rect.width); const lineHeight = style.lineHeight || style.fontSize * 1.35; lines.slice(0, Math.max(1, Math.floor(layer.rect.height / lineHeight))).forEach((line, index) => { const x = style.align === "center" ? layer.rect.x + layer.rect.width / 2 : style.align === "right" ? layer.rect.x + layer.rect.width : layer.rect.x; context.fillText(line, x, layer.rect.y + index * lineHeight); }); }
function normalizeFontWeight(weight: number) {
    if (weight >= 700) return 700;
    if (weight >= 600) return 600;
    if (weight >= 500) return 500;
    return 400;
}
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) { const result: string[] = []; for (const paragraph of text.split(/\n/)) { let line = ""; for (const character of paragraph) { const candidate = line + character; if (line && context.measureText(candidate).width > maxWidth) { result.push(line); line = character; } else line = candidate; } if (line) result.push(line); } return result; }
