import { CheckCircle2, CircleDashed, Image, MessageSquareText, Sparkles } from "lucide-react";
import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import { isProductBriefReady } from "@/lib/product-detail/brief";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import type { ProductBrief, ProductDetailAsset } from "@/types/product-detail";

export function BriefSummaryPanel({ brief, assets }: { brief: ProductBrief; assets: ProductDetailAsset[] }) {
    const { t } = useTranslation();
    const ready = isProductBriefReady(brief);
    const missing = missingFields(brief);
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className={`rounded-2xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950/20"}`}>
                <div className="flex items-start gap-3"><span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${ready ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"}`}>{ready ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-4" />}</span><div><div className="text-sm font-semibold">{ready ? t("productDetail.ready") : t("productDetail.notReady")}</div><div className="mt-1 text-xs leading-5 text-stone-500">所有信息都由左侧对话自动整理，你也可以继续用自然语言修改。</div></div></div>
                {missing.length ? <div className="mt-3 flex flex-wrap gap-1.5">{missing.map((item) => <Tag key={item} icon={<CircleDashed className="size-3" />} className="m-0">{item}</Tag>)}</div> : null}
            </div>

            <section className="mt-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500"><MessageSquareText className="size-3.5" />{t("productDetail.brief")}</div>
                <div className="space-y-3 text-sm">
                    <Summary label={t("productDetail.productName")} value={brief.productName || "-"} />
                    <Summary label={t("productDetail.category")} value={brief.category || "-"} />
                    <Summary label={t("productDetail.platform")} value={PRODUCT_DETAIL_PLATFORM_PROFILES[brief.platform].label} />
                    <Summary label={t("productDetail.targetAudience")} value={brief.targetAudience.join("、") || "-"} />
                    <Summary label={t("productDetail.sellingPoints")} value={brief.sellingPoints.filter((item) => item.source !== "unconfirmed").map((item) => item.text).join("、") || "-"} />
                    <Summary label={t("productDetail.visualStyle")} value={brief.visualStyle.join("、") || "-"} />
                    <Summary label={t("productDetail.colors")} value={brief.colorPreference.join("、") || "-"} />
                    <Summary label={t("productDetail.copyTone")} value={brief.copyTone.join("、") || "-"} />
                    <Summary label={t("productDetail.forbiddenContent")} value={brief.forbiddenContent.join("、") || "-"} />
                </div>
            </section>

            <section className="mt-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500"><Image className="size-3.5" />附件</div><span className="text-[11px] text-stone-400">{assets.length}</span></div>
                {assets.length ? <div className="grid grid-cols-4 gap-2">{assets.map((asset) => <div key={asset.id} className="relative aspect-square overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">{asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-white">{asset.kind === "product" ? "商品图" : "参考图"}</span></div>)}</div> : <div className="rounded-lg border border-dashed border-stone-200 p-4 text-center text-xs text-stone-500 dark:border-stone-800">在左侧输入框上传商品图或参考详情页。</div>}
            </section>
        </div>
    );
}

function Summary({ label, value }: { label: string; value: string }) { return <div><div className="text-[11px] text-stone-500">{label}</div><div className="mt-0.5 whitespace-pre-wrap break-words leading-6 text-stone-800 dark:text-stone-200">{value}</div></div>; }
function missingFields(brief: ProductBrief) { const result: string[] = []; if (!brief.productName.trim()) result.push("商品名称"); if (!brief.category.trim()) result.push("商品类目"); if (!brief.targetAudience.length) result.push("目标人群"); if (!brief.sellingPoints.some((item) => item.source !== "unconfirmed")) result.push("确认卖点"); return result; }
