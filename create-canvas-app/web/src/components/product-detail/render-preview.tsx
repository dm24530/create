import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Progress } from "antd";
import { Download, ImagePlus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DetailImagePreview } from "@/components/product-detail/detail-image-preview";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import {
    bytesFromBlob,
    buildExportManifest,
    createZipBlob,
    encodeCanvasForPlatform,
    planSliceRanges,
    profileFileExtension,
    profileMimeType,
    verifyExportedZip,
} from "@/lib/product-detail/export";
import { buildPageSpec } from "@/lib/product-detail/layout";
import { isStoryboardStale } from "@/lib/product-detail/storyboard";
import { renderPageToCanvas, stitchLongImage, type CanvasImageLoader } from "@/lib/product-detail/renderer";
import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import { saveGeneratedFile } from "@/lib/desktop-save";
import type { ProductDetailPlatform, ProductDetailProject, StoryboardPage, UserDesignSkill } from "@/types/product-detail";

export function RenderPreview({ project, platform, skill, onGenerateImage }: { project: ProductDetailProject; platform: ProductDetailPlatform; skill: UserDesignSkill; onGenerateImage: (page: StoryboardPage) => Promise<void>; }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [previews, setPreviews] = useState<Array<{ pageId: string; url: string }>>([]);
    const [longPreview, setLongPreview] = useState<{ url: string; width: number; height: number } | null>(null);
    const [viewMode, setViewMode] = useState<"pages" | "long">("pages");
    const [rendering, setRendering] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const pages = project.storyboard?.pages || [];
    const storyboardStale = isStoryboardStale(project.storyboard, project.brief);
    const usable = Boolean(project.storyboard && project.storyboard.status === "confirmed" && !project.storyboard.warning && !storyboardStale);
    const generatedPages = pages.filter((page) => page.generatedAssetId);
    const allPagesGenerated = pages.length > 0 && generatedPages.length === pages.length;
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
        if (!usable) { message.warning(storyboardStale ? "商品信息已更新，请先同步并确认当前分镜再预览。" : "请先确认当前分镜，再渲染预览。"); return; }
        if (!generatedPages.length) { message.warning("请先生成至少一页无字底图。"); return; }
        setRendering(true);
        setProgress(0);
        try {
            const next: Array<{ pageId: string; url: string }> = [];
            for (let index = 0; index < generatedPages.length; index += 1) {
                const page = generatedPages[index];
                const spec = buildPageSpec(page, project.brief, skill, platform);
                if (spec.validation.some((item) => item.severity === "error")) throw new Error(`“${page.title}”校验失败：${spec.validation.find((item) => item.severity === "error")?.message || "页面内容超出安全区域"}`);
                const canvas = await renderPageToCanvas(spec, imageLoader);
                next.push({ pageId: page.id, url: canvas.toDataURL("image/jpeg", 0.9) });
                setProgress(Math.round(((index + 1) / (generatedPages.length + (allPagesGenerated ? 1 : 0))) * 100));
            }
            setPreviews(next);
            if (allPagesGenerated) {
                const longSpecs = pages.map((page) => buildPageSpec(page, project.brief, skill, platform));
                const longCanvas = stitchLongImage(await Promise.all(longSpecs.map((spec) => renderPageToCanvas(spec, imageLoader))));
                setLongPreview({ url: longCanvas.toDataURL("image/jpeg", 0.92), width: longCanvas.width, height: longCanvas.height });
                setViewMode("long");
                setProgress(100);
                message.success("单页预览和完整长图已生成");
            } else {
                setLongPreview(null);
                setViewMode("pages");
                message.warning(`已生成 ${generatedPages.length} 页预览，完成全部底图后才能合成完整长图。`);
            }
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setRendering(false); }
    };

    const downloadLongImage = async () => {
        if (!usable) { message.warning("请先确认当前分镜。"); return; }
        if (!allPagesGenerated) { message.warning(`还有 ${pages.length - generatedPages.length} 页未生成底图，不能导出完整长图。`); return; }
        setRendering(true); setProgress(0);
        try {
            const profile = PRODUCT_DETAIL_PLATFORM_PROFILES[platform];
            const specs = pages.map((page) => buildPageSpec(page, project.brief, skill, platform));
            const canvases: HTMLCanvasElement[] = [];
            for (const [index, spec] of specs.entries()) {
                if (spec.validation.some((item) => item.severity === "error")) throw new Error(`“${pages[index]?.title || "当前页面"}”校验失败：${spec.validation.find((item) => item.severity === "error")?.message || "页面内容超出安全区域"}`);
                canvases.push(await renderPageToCanvas(spec, imageLoader));
                setProgress(Math.round(((index + 1) / (specs.length + 1)) * 100));
            }
            const longCanvas = stitchLongImage(canvases);
            const blob = await encodeCanvasForPlatform(longCanvas, profile);
            await saveGeneratedFile(blob, "other", profileMimeType(profile), `${safeName(project.name)}-detail-page-long.${profileFileExtension(profile)}`);
            setLongPreview({ url: longCanvas.toDataURL("image/jpeg", 0.92), width: longCanvas.width, height: longCanvas.height });
            setViewMode("long"); setProgress(100);
            message.success(`完整长图已导出：${longCanvas.width}×${longCanvas.height}`);
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setRendering(false); }
    };

    const exportAll = async () => {
        if (!usable) { message.warning(storyboardStale ? "商品信息已更新，请先同步并确认当前分镜再导出。" : "请先确认当前分镜，再导出页面。"); return; }
        if (!allPagesGenerated) { message.warning(`还有 ${pages.length - generatedPages.length} 页未生成底图，不能导出完整详情页。`); return; }
        setExporting(true); setProgress(0);
        try {
            const profile = PRODUCT_DETAIL_PLATFORM_PROFILES[platform];
            const extension = profileFileExtension(profile);
            const files: Record<string, Uint8Array> = {};
            const specs = pages.map((page) => buildPageSpec(page, project.brief, skill, platform));
            const pageCanvases: HTMLCanvasElement[] = [];
            for (let index = 0; index < specs.length; index += 1) {
                const spec = specs[index];
                if (spec.validation.some((item) => item.severity === "error")) throw new Error(`“${pages[index]?.title || "当前页面"}”校验失败：${spec.validation.find((item) => item.severity === "error")?.message || "页面内容超出安全区域"}`);
                const canvas = await renderPageToCanvas(spec, imageLoader);
                pageCanvases.push(canvas);
                files[`pages/${String(index + 1).padStart(2, "0")}.${extension}`] = await bytesFromBlob(await encodeCanvasForPlatform(canvas, profile));
                setProgress(Math.round(((index + 1) / (specs.length + 3)) * 100));
            }
            const longCanvas = stitchLongImage(pageCanvases);
            files[`detail-page-long.${extension}`] = await bytesFromBlob(await encodeCanvasForPlatform(longCanvas, profile));
            const ranges = planSliceRanges(longCanvas.height, profile.maxSliceHeight);
            for (const [index, range] of ranges.entries()) {
                const sliceCanvas = document.createElement("canvas");
                sliceCanvas.width = longCanvas.width; sliceCanvas.height = range.height;
                sliceCanvas.getContext("2d")?.drawImage(longCanvas, 0, range.y, longCanvas.width, range.height, 0, 0, longCanvas.width, range.height);
                files[`slices/${String(index + 1).padStart(2, "0")}.${extension}`] = await bytesFromBlob(await encodeCanvasForPlatform(sliceCanvas, profile));
            }
            files["manifest.json"] = new TextEncoder().encode(JSON.stringify({
                ...buildExportManifest(project.id, project.name, specs),
                longImage: { width: longCanvas.width, height: longCanvas.height, file: `detail-page-long.${extension}` },
                sliceHeight: profile.maxSliceHeight,
                platform: profile.label,
            }, null, 2));
            const expectedFiles = Object.keys(files);
            const zipBlob = createZipBlob(files);
            const verification = await verifyExportedZip(zipBlob, expectedFiles);
            setProgress(100);
            await saveGeneratedFile(zipBlob, "other", "application/zip", `${safeName(project.name)}-detail-page.zip`);
            message.success(`详情页已导出并校验通过：${verification.entryCount} 个文件`);
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setExporting(false); }
    };

    useEffect(() => { setPreviews([]); setLongPreview(null); setViewMode("pages"); }, [project.id, project.storyboard?.revision, usable]);
    if (!pages.length) return <div className="flex flex-1 items-center justify-center p-8"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("productDetail.noStoryboard")} /></div>;

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
            <div className="mb-3 rounded-[18px] border border-black/[0.07] bg-white/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><div className="text-sm font-semibold tracking-[-0.02em]">{t("productDetail.results")}</div><div className="mt-1 text-[10px] text-stone-400">{generatedPages.length} / {pages.length} 页已生成底图{allPagesGenerated ? " · 可合成完整长图" : ""}</div></div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button icon={<RefreshCw className="size-3.5" />} loading={rendering} disabled={!usable} onClick={() => void render()} className="h-8 rounded-full border-black/[0.08] bg-white px-3 text-[10px] shadow-none dark:border-white/10 dark:bg-transparent">生成预览</Button>
                        <Button icon={<Download className="size-3.5" />} loading={rendering} disabled={!allPagesGenerated || !usable} onClick={() => void downloadLongImage()} className="h-8 rounded-full border-black/[0.08] bg-white px-3 text-[10px] shadow-none dark:border-white/10 dark:bg-transparent">下载长图</Button>
                        <Button type="primary" icon={<Download className="size-3.5" />} loading={exporting} disabled={!allPagesGenerated || !usable} onClick={() => void exportAll()} className="h-8 rounded-full border-0 bg-[#22211f] px-3 text-[10px] font-semibold shadow-none hover:!bg-black dark:!bg-stone-100 dark:!text-stone-950 dark:hover:!bg-white dark:hover:!text-stone-950">导出 ZIP</Button>
                    </div>
                </div>
                {!usable ? <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-[10px] leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">{storyboardStale ? "商品信息已更新。请先同步并确认当前分镜，再渲染或导出。" : "当前分镜尚未确认或不是由 AI 正确生成，生成结果已锁定，不能继续渲染或导出。"}</div> : null}
                {usable && !allPagesGenerated ? <div className="mt-3 rounded-xl border border-sky-200/70 bg-sky-50/70 px-3 py-2.5 text-[10px] leading-5 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200">完整详情页必须等 {pages.length} 页底图全部生成后才能合成和导出。</div> : null}
            </div>
            {rendering || exporting ? <Progress className="mb-3" percent={progress} size="small" /> : null}
            {longPreview ? <div className="mb-3 flex justify-center"><div className="inline-flex rounded-full border border-black/[0.08] bg-white/70 p-1 dark:border-white/10 dark:bg-white/[0.04]"><button type="button" onClick={() => setViewMode("pages")} className={`rounded-full px-3 py-1 text-[10px] transition ${viewMode === "pages" ? "bg-stone-900 !text-white dark:!bg-stone-100 dark:!text-stone-950" : "text-stone-500 hover:bg-white/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.08] dark:hover:text-white"}`}>单页</button><button type="button" onClick={() => setViewMode("long")} className={`rounded-full px-3 py-1 text-[10px] transition ${viewMode === "long" ? "bg-stone-900 !text-white dark:!bg-stone-100 dark:!text-stone-950" : "text-stone-500 hover:bg-white/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.08] dark:hover:text-white"}`}>长图预览</button></div></div> : null}
            {viewMode === "long" && longPreview ? (
                <div className="rounded-[16px] border border-black/[0.06] bg-stone-100 p-2 dark:border-white/[0.08] dark:bg-stone-900"><div className="thin-scrollbar max-h-[68vh] overflow-y-auto rounded-xl bg-stone-200 dark:bg-stone-950"><img src={longPreview.url} alt="商品详情页长图" className="block h-auto w-full" /></div><div className="mt-2 text-center text-[10px] text-stone-500 dark:text-stone-400">完整长图 · {longPreview.width}×{longPreview.height}</div></div>
            ) : (
                <div className="grid grid-cols-2 gap-2.5">
                    {pages.map((page) => {
                        const preview = previews.find((item) => item.pageId === page.id);
                        const asset = page.generatedAssetId ? assetMap.get(page.generatedAssetId) : undefined;
                        const outdated = !usable && Boolean(asset?.url);
                        return <div key={page.id} className="overflow-hidden rounded-[16px] border border-black/[0.06] bg-white/70 dark:border-white/[0.08] dark:bg-white/[0.035]"><div className="relative aspect-[3/4] bg-stone-100 dark:bg-stone-800">{preview?.url ? <DetailImagePreview src={preview.url} alt={page.title} classNames={{ root: "!block h-full w-full cursor-zoom-in", image: "h-full w-full object-contain" }} previewCover={<span className="text-[10px] font-medium">点击放大</span>} /> : asset?.url ? <DetailImagePreview src={asset.url} alt={page.title} classNames={{ root: `!block h-full w-full cursor-zoom-in ${outdated ? "opacity-45" : "opacity-85"}`, image: "h-full w-full object-contain" }} previewCover={<span className="text-[10px] font-medium">点击放大</span>} /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-[10px] text-stone-400"><ImagePlus className="size-5" /><span>未生成底图</span></div>}{outdated ? <div className="absolute inset-x-2 top-2 rounded-lg bg-stone-950/75 px-2 py-1 text-center text-[9px] font-medium text-white">旧结果已失效</div> : null}</div><div className="p-2.5"><div className="flex items-center justify-between gap-2"><div className="truncate text-[10px] font-semibold text-stone-800 dark:text-stone-200">{page.title}</div>{!page.generatedAssetId ? <Button size="small" type="text" icon={<ImagePlus className="size-3.5" />} disabled={!usable} onClick={() => void onGenerateImage(page)} className="size-7 rounded-lg" /> : null}</div><div className="mt-1 text-[9px] text-stone-400">{outdated ? "需要重新生成" : page.status === "ready" ? "已保存到本地" : "等待生成"}</div></div></div>;
                    })}
                </div>
            )}
        </div>
    );
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => { const image = new Image(); image.crossOrigin = "anonymous"; image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = url; });
}
function safeName(value: string) { return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "product-detail"; }
