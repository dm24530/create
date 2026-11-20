import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, Image, MessageSquareText, Sparkles } from "lucide-react";
import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import { isProductBriefReady } from "@/lib/product-detail/brief";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import type { ProductBrief, ProductDetailAsset } from "@/types/product-detail";

const PRICE_POSITION_LABELS = { budget: "性价比", mid: "中端", premium: "高端" } as const;

export function BriefSummaryPanel({ brief, assets }: { brief: ProductBrief; assets: ProductDetailAsset[] }) {
    const { t } = useTranslation();
    const ready = isProductBriefReady(brief);
    const missing = missingFields(brief);
    const confirmedPoints = brief.sellingPoints.filter((item) => item.source !== "unconfirmed");
    const entries: Array<{ key: string; label: string; value: ReactNode }> = [];
    if (brief.productName.trim()) entries.push({ key: "productName", label: "商品名称", value: brief.productName });
    if (brief.category.trim()) entries.push({ key: "category", label: "商品类目", value: brief.category });
    if (brief.description.trim()) entries.push({ key: "description", label: "商品说明", value: brief.description });
    entries.push({ key: "platform", label: "目标平台", value: <span>{PRODUCT_DETAIL_PLATFORM_PROFILES[brief.platform].label}<span className="ml-1 text-[10px] text-stone-400">可通过对话修改</span></span> });
    if (brief.pricePosition) entries.push({ key: "pricePosition", label: "价格定位", value: PRICE_POSITION_LABELS[brief.pricePosition] });
    if (brief.targetAudience.length) entries.push({ key: "targetAudience", label: "目标人群", value: tags(brief.targetAudience) });
    if (confirmedPoints.length) entries.push({ key: "sellingPoints", label: "核心卖点", value: <div className="space-y-1.5">{confirmedPoints.map((point) => <div key={point.id} className="flex items-start gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" /><span className="min-w-0 flex-1">{point.text}<span className="ml-1 text-[10px] text-stone-400">{point.source === "visible" ? "图片可见" : "用户确认"}</span></span></div>)}</div> });
    if (brief.scenarios.length) entries.push({ key: "scenarios", label: "使用场景", value: tags(brief.scenarios) });
    if (brief.visualStyle.length) entries.push({ key: "visualStyle", label: "视觉风格", value: tags(brief.visualStyle) });
    if (brief.colorPreference.length) entries.push({ key: "colorPreference", label: "品牌色", value: <div className="flex flex-wrap gap-1.5">{brief.colorPreference.map((color) => <Tag key={color} className="m-0"><span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: color }} />{color}</Tag>)}</div> });
    if (brief.copyTone.length) entries.push({ key: "copyTone", label: "文案语气", value: tags(brief.copyTone) });
    if (brief.forbiddenContent.length) entries.push({ key: "forbiddenContent", label: "禁用表达", value: tags(brief.forbiddenContent, "red") });

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className={`rounded-2xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950/20"}`}>
                <div className="flex items-start gap-3"><span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${ready ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"}`}>{ready ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-4" />}</span><div><div className="text-sm font-semibold">{ready ? t("productDetail.ready") : t("productDetail.notReady")}</div><div className="mt-1 text-xs leading-5 text-stone-500">{ready ? "Agent 已整理出可生成分镜的关键信息。你可以继续在对话里修改任何内容。" : "不用填写表单。继续在左侧对话里补充，Agent 会实时整理这里的信息。"}</div></div></div>
                {missing.length ? <div className="mt-3 flex flex-wrap gap-1.5">{missing.map((item) => <Tag key={item} icon={<CircleDashed className="size-3" />} className="m-0">{item}</Tag>)}</div> : null}
            </div>

            <section className="mt-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500"><MessageSquareText className="size-3.5" />Agent 已整理的信息</div>
                {entries.length ? <div className="space-y-3 text-sm">{entries.map((entry) => <div key={entry.key}><div className="text-[11px] text-stone-500">{entry.label}</div><div className="mt-0.5 break-words leading-6 text-stone-800 dark:text-stone-200">{entry.value}</div></div>)}</div> : <div className="rounded-lg bg-stone-50 px-3 py-3 text-xs leading-6 text-stone-500 dark:bg-stone-950/60">还没有整理出可确认的信息。继续在左侧对话里补充，这里只会显示已经收集到的内容。</div>}
            </section>

            <section className="mt-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500"><Image className="size-3.5" />商品与参考素材</div><span className="text-[11px] text-stone-400">{assets.length}</span></div>
                {assets.length ? <div className="grid grid-cols-4 gap-2">{assets.map((asset) => <div key={asset.id} className="relative aspect-square overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">{asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-white">{asset.kind === "product" ? "商品图" : "参考图"}</span></div>)}</div> : <div className="rounded-lg border border-dashed border-stone-200 p-4 text-center text-xs leading-5 text-stone-500 dark:border-stone-800">直接在左侧输入框上传商品图或参考详情页，附件会随下一轮对话一起交给 Agent。</div>}
            </section>
        </div>
    );
}

function tags(values: string[], color?: string) {
    return <div className="flex flex-wrap gap-1.5">{values.map((value) => <Tag key={value} color={color} className="m-0">{value}</Tag>)}</div>;
}

function missingFields(brief: ProductBrief) {
    const result: string[] = [];
    if (!brief.productName.trim()) result.push("商品名称");
    if (!brief.category.trim()) result.push("商品类目");
    if (!brief.targetAudience.length) result.push("目标人群");
    if (!brief.sellingPoints.some((item) => item.source !== "unconfirmed")) result.push("确认卖点");
    return result;
}
