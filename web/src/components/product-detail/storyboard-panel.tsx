import { ArrowDown, ArrowUp, CheckCircle2, ImagePlus, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { Button, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ProductDetailAsset, ProductPageRole, Storyboard, StoryboardPage } from "@/types/product-detail";

const ROLE_LABELS: Record<ProductPageRole, string> = {
    hero: "首屏", "pain-point": "痛点", "core-benefit": "利益", "feature-detail": "细节", scenario: "场景", "how-to-use": "步骤", specification: "规格", trust: "信任", closing: "收尾",
};

export function StoryboardPanel({ storyboard, assets, generatingPageIds, onMove, onDelete, onConfirm, onGenerate, onGenerateAll, generatingAll, onRequestChange }: {
    storyboard?: Storyboard;
    assets: ProductDetailAsset[];
    generatingPageIds: string[];
    onMove: (pageId: string, offset: number) => void;
    onDelete: (pageId: string) => void;
    onConfirm: () => void;
    onGenerate: (page: StoryboardPage) => Promise<void>;
    onGenerateAll: () => Promise<void>;
    generatingAll: boolean;
    onRequestChange: (request: string) => void;
}) {
    const { t } = useTranslation();
    if (!storyboard) return <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><MessageSquareText className="mb-3 size-7 text-stone-300" /><div className="text-sm text-stone-500">{t("productDetail.noStoryboard")}</div><div className="mt-2 max-w-xs text-xs leading-5 text-stone-400">在左侧对话里说“生成分镜”，或补充商品信息后让 Agent 继续。</div></div>;
    const confirmed = storyboard.status === "confirmed";
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Tag color={confirmed ? "green" : "orange"} className="m-0">{confirmed ? t("productDetail.confirmed") : t("productDetail.storyboard")}</Tag><span className="text-xs text-stone-500">Rev {storyboard.revision} · {storyboard.pages.length} 页</span></div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="small" icon={<MessageSquareText className="size-3.5" />} onClick={() => onRequestChange("请调整当前分镜结构：新增一页，并说明放在哪个位置，页面文案和视觉方向是什么。")}>对话新增</Button>
                        {confirmed ? <Button size="small" icon={<ImagePlus className="size-3.5" />} loading={generatingAll} onClick={() => void onGenerateAll()}>生成全部</Button> : <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={onConfirm}>{t("productDetail.confirmStoryboard")}</Button>}
                    </div>
                </div>
                <div className="mt-2 text-[11px] leading-5 text-stone-500">分镜内容只需要通过对话修改。确认后 Agent 才能生成底图；单页失败不会影响其他页面。</div>
            </div>
            <div className="space-y-3">
                {storyboard.pages.map((page, index) => {
                    const asset = page.generatedAssetId ? assets.find((item) => item.id === page.generatedAssetId) : undefined;
                    const generating = generatingPageIds.includes(page.id) || page.status === "generating";
                    const referenceAssets = page.referenceAssetIds.map((id) => assets.find((item) => item.id === id)).filter(Boolean).slice(0, 4) as ProductDetailAsset[];
                    return (
                        <div key={page.id} className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900/60">
                            <div className="mb-2 flex items-center gap-2">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-950">{page.order}</span>
                                <Tag className="m-0" color="blue">{ROLE_LABELS[page.role]}</Tag>
                                <span className="min-w-0 flex-1 truncate text-xs text-stone-500">{page.layoutTemplateId}</span>
                                {confirmed && !page.generatedAssetId ? <Button size="small" type="text" icon={<ImagePlus className="size-3.5" />} loading={generating} onClick={() => void onGenerate(page)} /> : null}
                                <Button size="small" type="text" disabled={index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(page.id, -1)} />
                                <Button size="small" type="text" disabled={index === storyboard.pages.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(page.id, 1)} />
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(page.id)} />
                            </div>
                            <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">{page.title}</div>
                            <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-stone-600 dark:text-stone-300">{page.message}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <Button size="small" type="dashed" icon={<MessageSquareText className="size-3.5" />} onClick={() => onRequestChange(`请修改第 ${page.order} 页分镜“${page.title}”：`)}>让 AI 修改这一页</Button>
                                <Tag className="m-0 text-[10px]">{page.status === "ready" ? "底图已生成" : page.status === "failed" ? "生成失败" : generating ? "生成中" : "待生成"}</Tag>
                                {page.factRefs.length ? <Tag className="m-0 text-[10px]" color="green">事实引用 {page.factRefs.length}</Tag> : null}
                            </div>
                            {page.error ? <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-600 dark:bg-red-950/30 dark:text-red-300">{page.error}</div> : null}
                            {asset?.url ? <div className="mt-2 h-24 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800"><img src={asset.url} alt={page.title} className="h-full w-full object-cover" /></div> : null}
                            {referenceAssets.length ? <div className="mt-2 flex gap-1.5">{referenceAssets.map((reference) => <div key={reference.id} className="size-10 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-800">{reference.url ? <img src={reference.url} alt={reference.name} className="h-full w-full object-cover" /> : null}</div>)}</div> : null}
                            <details className="mt-2 rounded-lg bg-stone-50 px-2.5 py-2 text-[11px] leading-5 text-stone-500 dark:bg-stone-950/60">
                                <summary className="cursor-pointer select-none font-medium">查看视觉提示词</summary>
                                <div className="mt-1.5 whitespace-pre-wrap">{page.visualPrompt}</div>
                                {page.negativePrompt.length ? <div className="mt-1.5">禁用：{page.negativePrompt.join("、")}</div> : null}
                            </details>
                        </div>
                    );
                })}
            </div>
            <Button block type="dashed" icon={<Plus className="size-3.5" />} className="mt-3" onClick={() => onRequestChange("请在当前分镜中新增一页，并直接给出完整的新分镜。")}>通过对话新增一页</Button>
        </div>
    );
}
