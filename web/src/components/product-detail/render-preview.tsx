import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Progress } from "antd";
import { Download, ImagePlus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { bytesFromBlob, buildExportManifest, createZipBlob, planSliceRanges } from "@/lib/product-detail/export";
import { buildPageSpec } from "@/lib/product-detail/layout";
import { canvasToBlob, renderPageToCanvas, stitchLongImage, type CanvasImageLoader } from "@/lib/product-detail/renderer";
import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import { saveGeneratedFile } from "@/lib/desktop-save";
import type { ProductDetailPlatform, ProductDetailProject, StoryboardPage, UserDesignSkill } from "@/types/product-detail";

export function RenderPreview({ project, platform, skill, onGenerateImage }: { project: ProductDetailProject; platform: ProductDetailPlatform; skill: UserDesignSkill; onGenerateImage: (page: StoryboardPage) => Promise<void>; }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [previews, setPreviews] = useState<Array<{ pageId: string; url: string }>>([]);
    const [rendering, setRendering] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const pages = project.storyboard?.pages || [];
    const generatedPages = pages.filter((page) => page.generatedAssetId);
    const assetMap = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets]);
    const imageLoader: CanvasImageLoader = async (assetId) => {
        const asset = assetMap.get(assetId);
        if (!asset) return null;
        const blob = asset.storageKey ? await getImageBlob(asset.storageKey) : null;
        if (blob) return createImageBitmap(blob);
        const url = asset.url || await resolveImageUrl(asset.storageKey, "");
        return url ? loadImage(url) : null;
    };
    const render = async () => {
        if (!generatedPages.length) { message.warning("请先生成至少一页无字底图。"); return; }
        setRendering(true); setProgress(0);
        try {
            const next: Array<{ pageId: string; url: string }> = [];
            for (let index = 0; index < generatedPages.length; index += 1) {
                const page = generatedPages[index];
                const spec = buildPageSpec(page, project.brief, skill, platform);
                if (spec.validation.some((item) => item.severity === "error")) throw new Error(spec.validation.find((item) => item.severity === "error")?.message || "页面校验失败");
                const canvas = await renderPageToCanvas(spec, imageLoader);
                next.push({ pageId: page.id, url: canvas.toDataURL("image/jpeg", 0.9) });
                setProgress(Math.round(((index + 1) / generatedPages.length) * 100));
            }
            setPreviews(next); message.success("页面预览已生成");
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setRendering(false); }
    };
    const exportAll = async () => {
        if (!generatedPages.length) return;
        setExporting(true); setProgress(0);
        try {
            const files: Record<string, Uint8Array> = {};
            const specs = generatedPages.map((page) => buildPageSpec(page, project.brief, skill, platform));
            for (let index = 0; index < specs.length; index += 1) {
                const canvas = await renderPageToCanvas(specs[index], imageLoader);
                const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
                files[`pages/${String(index + 1).padStart(2, "0")}.jpg`] = await bytesFromBlob(blob);
                setProgress(Math.round(((index + 1) / (specs.length + 2)) * 100));
            }
            const longCanvas = stitchLongImage(await Promise.all(specs.map((spec) => renderPageToCanvas(spec, imageLoader))));
            files["detail-page-long.jpg"] = await bytesFromBlob(await canvasToBlob(longCanvas, "image/jpeg", 0.92));
            const ranges = planSliceRanges(longCanvas.height, 2000);
            for (const [index, range] of ranges.entries()) {
                const sliceCanvas = document.createElement("canvas"); sliceCanvas.width = longCanvas.width; sliceCanvas.height = range.height;
                sliceCanvas.getContext("2d")?.drawImage(longCanvas, 0, range.y, longCanvas.width, range.height, 0, 0, longCanvas.width, range.height);
                files[`slices/${String(index + 1).padStart(2, "0")}.jpg`] = await bytesFromBlob(await canvasToBlob(sliceCanvas, "image/jpeg", 0.92));
            }
            files["manifest.json"] = new TextEncoder().encode(JSON.stringify(buildExportManifest(project.id, project.name, specs), null, 2));
            await saveGeneratedFile(createZipBlob(files), "other", "application/zip", `${safeName(project.name)}-detail-page.zip`);
            message.success("详情页已导出");
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setExporting(false); }
    };
    useEffect(() => { setPreviews([]); }, [project.id, project.storyboard?.revision]);
    if (!pages.length) return <div className="flex flex-1 items-center justify-center p-8"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("productDetail.noStoryboard")} /></div>;
    return <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-3 flex items-center justify-between"><div><div className="text-sm font-semibold">{t("productDetail.results")}</div><div className="mt-1 text-xs text-stone-500">{generatedPages.length} / {pages.length} 页已生成底图</div></div><div className="flex gap-2"><Button icon={<RefreshCw className="size-4" />} loading={rendering} onClick={() => void render()}>渲染预览</Button><Button type="primary" icon={<Download className="size-4" />} loading={exporting} disabled={!generatedPages.length} onClick={() => void exportAll()}>导出 ZIP</Button></div></div>{rendering || exporting ? <Progress className="mb-4" percent={progress} size="small" /> : null}<div className="grid gap-3 sm:grid-cols-2">{pages.map((page) => { const preview = previews.find((item) => item.pageId === page.id); const asset = page.generatedAssetId ? assetMap.get(page.generatedAssetId) : undefined; return <div key={page.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/60"><div className="relative aspect-[3/4] bg-stone-100 dark:bg-stone-800">{preview?.url ? <img src={preview.url} alt={page.title} className="h-full w-full object-cover" /> : asset?.url ? <img src={asset.url} alt={page.title} className="h-full w-full object-cover opacity-80" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-stone-500"><ImagePlus className="size-5" /><span>未生成底图</span></div>}</div><div className="p-3"><div className="flex items-center justify-between gap-2"><div className="truncate text-xs font-semibold">{page.order}. {page.title}</div>{!page.generatedAssetId ? <Button size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => void onGenerateImage(page)}>生成</Button> : null}</div><div className="mt-1 text-[11px] text-stone-500">{page.status === "ready" ? "底图已保存到本地" : "等待生成"}</div></div></div>; })}</div></div>;
}
function loadImage(url: string): Promise<HTMLImageElement | null> { return new Promise((resolve) => { const image = new Image(); image.crossOrigin = "anonymous"; image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = url; }); }
function safeName(value: string) { return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "product-detail"; }
