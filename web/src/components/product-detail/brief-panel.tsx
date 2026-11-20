import { ImagePlus, Upload } from "lucide-react";
import { Input, Select } from "antd";
import { useTranslation } from "react-i18next";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import { isProductBriefReady } from "@/lib/product-detail/brief";
import type { ProductBrief, ProductDetailAsset, ProductDetailPlatform } from "@/types/product-detail";

export function BriefPanel({ brief, assets, uploading, onPatch, onUpload }: { brief: ProductBrief; assets: ProductDetailAsset[]; uploading: boolean; onPatch: (patch: Partial<ProductBrief>) => void; onUpload: (files: FileList | null) => void; }) {
    const { t } = useTranslation();
    const ready = isProductBriefReady(brief);
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className={`mb-4 rounded-xl border p-3 ${ready ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20"}`}><div className="text-xs font-semibold text-stone-800 dark:text-stone-200">{ready ? t("productDetail.ready") : t("productDetail.notReady")}</div><div className="mt-1 text-[11px] leading-5 text-stone-500">{brief.productName || t("productDetail.productName")} · {PRODUCT_DETAIL_PLATFORM_PROFILES[brief.platform].label} · {brief.revision ? `Rev ${brief.revision}` : "Draft"}</div></div>
            <Field label={t("productDetail.productName")}><Input value={brief.productName} onChange={(event) => onPatch({ productName: event.target.value })} /></Field>
            <Field label={t("productDetail.category")}><Input value={brief.category} onChange={(event) => onPatch({ category: event.target.value })} /></Field>
            <Field label={t("productDetail.platform")}><Select className="w-full" value={brief.platform} options={Object.values(PRODUCT_DETAIL_PLATFORM_PROFILES).map((profile) => ({ value: profile.id, label: profile.label }))} onChange={(platform: ProductDetailPlatform) => onPatch({ platform })} /></Field>
            <Field label={t("productDetail.description")}><Input.TextArea value={brief.description} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => onPatch({ description: event.target.value })} /></Field>
            <Field label={t("productDetail.addProductImages")} hint={t("productDetail.attachedAssets", { count: brief.productAssetIds.length })}><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-5 text-xs text-stone-500 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900/40">{uploading ? <span className="size-4 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" /> : <Upload className="size-4" />}<ImagePlus className="size-4" />{t("productDetail.addProductImages")}<input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} /></label>{assets.length ? <div className="mt-2 grid grid-cols-4 gap-2">{assets.map((asset) => <div key={asset.id} className="aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900">{asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}</div>)}</div> : null}</Field>
            <ArrayField label={t("productDetail.targetAudience")} values={brief.targetAudience} onChange={(targetAudience) => onPatch({ targetAudience })} />
            <ArrayField label={t("productDetail.scenarios")} values={brief.scenarios} onChange={(scenarios) => onPatch({ scenarios })} />
            <ArrayField label={t("productDetail.sellingPoints")} values={brief.sellingPoints.map((item) => item.text)} onChange={(values) => onPatch({ sellingPoints: values.map((text, index) => ({ id: brief.sellingPoints[index]?.id || `selling-${index}-${Date.now()}`, text, source: "user" })) })} />
            <ArrayField label={t("productDetail.visualStyle")} values={brief.visualStyle} onChange={(visualStyle) => onPatch({ visualStyle })} />
            <ArrayField label={t("productDetail.colors")} values={brief.colorPreference} onChange={(colorPreference) => onPatch({ colorPreference })} />
            <ArrayField label={t("productDetail.copyTone")} values={brief.copyTone} onChange={(copyTone) => onPatch({ copyTone })} />
            <ArrayField label={t("productDetail.forbiddenContent")} values={brief.forbiddenContent} onChange={(forbiddenContent) => onPatch({ forbiddenContent })} />
        </div>
    );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <div className="mb-3"><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-medium text-stone-600 dark:text-stone-400">{label}</span>{hint ? <span className="text-[10px] text-stone-400">{hint}</span> : null}</div>{children}</div>; }
function ArrayField({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) { const { t } = useTranslation(); return <Field label={label} hint={t("productDetail.commaSeparated")}><Input.TextArea value={values.join("，")} autoSize={{ minRows: 1, maxRows: 4 }} onChange={(event) => onChange(splitList(event.target.value))} /></Field>; }
function splitList(value: string) { return value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean); }
