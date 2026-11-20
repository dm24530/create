import { ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button, Input, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ProductDetailAsset, ProductPageRole, Storyboard, StoryboardPage } from "@/types/product-detail";

const ROLE_LABELS: Record<ProductPageRole, string> = {
    hero: "首屏", "pain-point": "痛点", "core-benefit": "利益", "feature-detail": "细节", scenario: "场景", "how-to-use": "步骤", specification: "规格", trust: "信任", closing: "收尾",
};

export function StoryboardPanel({ storyboard, assets, generatingPageId, onUpdate, onMove, onDelete, onAdd, onConfirm, onGenerate, onGenerateAll, generatingAll }: {
    storyboard?: Storyboard;
    assets: ProductDetailAsset[];
    generatingPageId?: string;
    onUpdate: (pageId: string, patch: Partial<StoryboardPage>) => void;
    onMove: (pageId: string, offset: number) => void;
    onDelete: (pageId: string) => void;
    onAdd: () => void;
    onConfirm: () => void;
    onGenerate: (page: StoryboardPage) => Promise<void>;
    onGenerateAll: () => Promise<void>;
    generatingAll: boolean;
}) {
    const { t } = useTranslation();
    if (!storyboard) return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-stone-500">{t("productDetail.noStoryboard")}</div>;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2"><Tag color={storyboard.status === "confirmed" ? "green" : "orange"} className="m-0">{storyboard.status === "confirmed" ? t("productDetail.confirmed") : t("productDetail.storyboard")}</Tag><span className="text-xs text-stone-500">Rev {storyboard.revision}</span></div>
                <div className="flex gap-2"><Button size="small" icon={<Plus className="size-3.5" />} onClick={onAdd}>添加</Button>{storyboard.status === "confirmed" ? <Button size="small" icon={<ImagePlus className="size-3.5" />} loading={generatingAll} onClick={() => void onGenerateAll()}>生成全部</Button> : null}<Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={onConfirm}>{t("productDetail.confirmStoryboard")}</Button></div>
            </div>
            <div className="space-y-3">
                {storyboard.pages.map((page, index) => {
                    const asset = page.generatedAssetId ? assets.find((item) => item.id === page.generatedAssetId) : undefined;
                    return (
                        <div key={page.id} className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900/60">
                            <div className="mb-2 flex items-center gap-2">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-950">{page.order}</span>
                                <Tag className="m-0" color="blue">{ROLE_LABELS[page.role]}</Tag>
                                <span className="min-w-0 flex-1 truncate text-xs text-stone-500">{page.layoutTemplateId}</span>
                                {storyboard.status === "confirmed" && !page.generatedAssetId ? <Button size="small" type="text" icon={<ImagePlus className="size-3.5" />} loading={generatingPageId === page.id} onClick={() => void onGenerate(page)} /> : null}
                                <Button size="small" type="text" disabled={index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(page.id, -1)} />
                                <Button size="small" type="text" disabled={index === storyboard.pages.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(page.id, 1)} />
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(page.id)} />
                            </div>
                            <Input value={page.title} onChange={(event) => onUpdate(page.id, { title: event.target.value })} />
                            <Input.TextArea className="mt-2" value={page.message} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => onUpdate(page.id, { message: event.target.value })} />
                            {asset?.url ? <div className="mt-2 h-20 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800"><img src={asset.url} alt={page.title} className="h-full w-full object-cover" /></div> : null}
                            <div className="mt-2 rounded-lg bg-stone-50 p-2 text-[11px] leading-5 text-stone-500 dark:bg-stone-950/60">{page.visualPrompt}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}



