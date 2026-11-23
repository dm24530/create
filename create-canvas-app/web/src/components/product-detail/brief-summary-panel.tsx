import { CheckCircle2, CircleDashed, Image, MessageSquareText, Sparkles, Trash2 } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { isProductBriefReady, missingProductBriefFields } from "@/lib/product-detail/brief";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import type { ProductBrief, ProductBriefPatch, ProductDetailAsset } from "@/types/product-detail";

const PRICE_POSITION_LABELS = { budget: "性价比", mid: "中端", premium: "高端" } as const;

export function BriefSummaryPanel({ brief, assets, onUpdate, onRequestChange }: {
    brief: ProductBrief;
    assets: ProductDetailAsset[];
    onUpdate: (patch: ProductBriefPatch) => void;
    onRequestChange: () => void;
}) {
    const { t } = useTranslation();
    const ready = isProductBriefReady(brief);
    const missing = missingProductBriefFields(brief);
    const confirmedPoints = brief.sellingPoints.filter((item) => item.source !== "unconfirmed");

    const removeTag = (field: "targetAudience" | "scenarios" | "visualStyle" | "colorPreference" | "copyTone" | "forbiddenContent", value: string) => {
        onUpdate({ [field]: brief[field].filter((item) => item !== value) });
    };

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
            <div className="rounded-[18px] border border-black/[0.07] bg-white/70 p-4 shadow-[0_4px_16px_rgba(38,32,25,0.025)] dark:border-white/[0.08] dark:bg-white/[0.035]">
                <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${ready ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300" : "bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300"}`}>
                        {ready ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold tracking-[-0.02em]">{ready ? "关键信息已整理" : "正在整理关键信息"}</div>
                        <div className="mt-1 text-[11px] leading-5 text-stone-500 dark:text-stone-400">由 AI 根据对话自动更新。删除条目后会同步使旧分镜失效，修改需求请继续对话。</div>
                    </div>
                    <Button size="small" type="text" icon={<MessageSquareText className="size-3.5" />} onClick={onRequestChange} className="shrink-0 rounded-full text-stone-500 hover:!text-stone-900 dark:text-stone-400 dark:hover:!text-white">对话</Button>
                </div>
                {missing.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {missing.map((item) => (
                            <span key={item} className="inline-flex items-center gap-1 rounded-full border border-amber-200/70 bg-amber-50/70 px-2.5 py-1 text-[10px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                                <CircleDashed className="size-3" />
                                {item}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>

            <section className="mt-3 rounded-[18px] border border-black/[0.07] bg-white/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-stone-400 dark:text-stone-500"><Sparkles className="size-3.5" />项目理解</div>
                    <span className="text-[10px] text-stone-400">AI Brief</span>
                </div>
                <div className="space-y-3.5 text-sm">
                    <SummaryRow label="商品名称" value={brief.productName} />
                    <SummaryRow label="商品类目" value={brief.category} />
                    <SummaryRow label="目标平台" value={PRODUCT_DETAIL_PLATFORM_PROFILES[brief.platform].label} />
                    {brief.pricePosition ? <SummaryRow label="价格定位" value={PRICE_POSITION_LABELS[brief.pricePosition]} /> : null}
                    <SummaryRow label="商品说明" value={brief.description} multiline />
                    <TagRow label="目标人群" values={brief.targetAudience} onRemove={(value) => removeTag("targetAudience", value)} />
                    <TagRow label="使用场景" values={brief.scenarios} onRemove={(value) => removeTag("scenarios", value)} />
                    <TagRow label="视觉风格" values={brief.visualStyle} onRemove={(value) => removeTag("visualStyle", value)} />
                    <ColorRow values={brief.colorPreference} onRemove={(value) => removeTag("colorPreference", value)} />
                    <TagRow label="文案语气" values={brief.copyTone} onRemove={(value) => removeTag("copyTone", value)} />
                    <TagRow label="禁用表达" values={brief.forbiddenContent} onRemove={(value) => removeTag("forbiddenContent", value)} />

                    <div>
                        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-stone-400 dark:text-stone-500">核心卖点</div>
                        {confirmedPoints.length ? (
                            <div className="space-y-1.5">
                                {confirmedPoints.map((point) => (
                                    <div key={point.id} className="flex items-start gap-2 rounded-xl border border-black/[0.05] bg-stone-50/70 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                                        <span className="min-w-0 flex-1 text-xs leading-5 text-stone-700 dark:text-stone-300">{point.text}</span>
                                        <span className="mt-0.5 shrink-0 text-[9px] text-stone-400">{point.source === "visible" ? "图片可见" : "用户确认"}</span>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => onUpdate({ sellingPoints: brief.sellingPoints.filter((item) => item.id !== point.id) })} className="size-7 rounded-lg" />
                                    </div>
                                ))}
                            </div>
                        ) : <div className="rounded-xl border border-dashed border-black/[0.08] px-3 py-4 text-center text-[11px] text-stone-400 dark:border-white/[0.08] dark:text-stone-500">AI 尚未整理出已确认卖点。</div>}
                    </div>
                    {!brief.productName && !brief.category && !brief.description && !confirmedPoints.length && !brief.targetAudience.length ? (
                        <div className="rounded-xl border border-dashed border-black/[0.08] p-4 text-center text-[11px] leading-5 text-stone-500 dark:border-white/[0.08] dark:text-stone-400">还没有整理出关键信息。可以在对话中描述商品，或直接粘贴商品图。</div>
                    ) : null}
                </div>
            </section>

            <section className="mt-3 rounded-[18px] border border-black/[0.07] bg-white/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
                <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-stone-400 dark:text-stone-500"><Image className="size-3.5" />商品与参考素材</div>
                    <span className="text-[10px] text-stone-400">{assets.length}</span>
                </div>
                {assets.length ? (
                    <div className="grid grid-cols-4 gap-2">
                        {assets.map((asset) => (
                            <div key={asset.id} className="relative aspect-square overflow-hidden rounded-xl bg-stone-100 dark:bg-stone-800">
                                {asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}
                                <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-black/65 px-1.5 py-0.5 text-[8px] text-white">{asset.kind === "product" ? "商品图" : "参考图"}</span>
                            </div>
                        ))}
                    </div>
                ) : <div className="rounded-xl border border-dashed border-black/[0.08] p-4 text-center text-[11px] leading-5 text-stone-500 dark:border-white/[0.08] dark:text-stone-400">直接在左侧输入框上传商品图或参考详情页。</div>}
            </section>
        </div>
    );
}

function SummaryRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
    if (!value.trim()) return null;
    return <div><div className="text-[10px] font-medium uppercase tracking-[0.08em] text-stone-400 dark:text-stone-500">{label}</div><div className={`mt-1 break-words text-xs leading-6 text-stone-800 dark:text-stone-200 ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</div></div>;
}

function TagRow({ label, values, onRemove }: { label: string; values: string[]; onRemove: (value: string) => void }) {
    if (!values.length) return null;
    return (
        <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-stone-400 dark:text-stone-500">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {values.map((value) => (
                    <span key={value} className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-stone-50 px-2.5 py-1 text-[10px] text-stone-600 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-stone-300">
                        {value}
                        <button type="button" onClick={() => onRemove(value)} className="text-stone-400 transition hover:text-stone-900 dark:hover:text-white" aria-label={`移除 ${label} ${value}`}>×</button>
                    </span>
                ))}
            </div>
        </div>
    );
}

function ColorRow({ values, onRemove }: { values: string[]; onRemove: (value: string) => void }) {
    if (!values.length) return null;
    return (
        <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-stone-400 dark:text-stone-500">品牌色</div>
            <div className="flex flex-wrap gap-1.5">
                {values.map((value) => (
                    <span key={value} className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-stone-50 px-2.5 py-1 text-[10px] text-stone-600 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-stone-300">
                        <span className="size-2 rounded-full" style={{ backgroundColor: value }} />
                        {value}
                        <button type="button" onClick={() => onRemove(value)} className="text-stone-400 transition hover:text-stone-900 dark:hover:text-white" aria-label={`移除品牌色 ${value}`}>×</button>
                    </span>
                ))}
            </div>
        </div>
    );
}