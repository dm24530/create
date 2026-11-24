import { Popover, Select } from "antd";

import { isPlazaVideoModel, plazaVideoBillingUnit, plazaVideoCapabilityLabels, plazaVideoDurationLabel, plazaVideoModelDescription, plazaVideoPricingRows, plazaVideoReferenceSummary } from "@/lib/plaza-video-model";
import type { CreateModelPlazaModel } from "@/services/create-account";
import type { WorkbenchModelDetails } from "@/hooks/use-model-plaza-details";

export type WorkbenchModelGroup = {
    id: string;
    name: string;
    models: Array<{ value: string; label: string }>;
};

type WorkbenchModelSelectProps = {
    label: string;
    value: string;
    groups: WorkbenchModelGroup[];
    details?: WorkbenchModelDetails;
    onChange: (value: string) => void;
    onEmptyOpen?: () => void;
};

function formatPrice(value: number) {
    return value >= 0.01 ? value.toFixed(2).replace(/\.?0+$/, "") : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function priceLines(model: CreateModelPlazaModel) {
    const pricing = model.pricing;
    if (!pricing) return [];
    const lines: string[] = [];
    if (pricing.billing_mode === "video") {
        const unit = plazaVideoBillingUnit(model) === "second" ? "/ 秒" : "/ 次";
        const rows = plazaVideoPricingRows(model);
        for (const row of rows.slice(0, 5)) lines.push(`${row.resolution} · ￥${formatPrice(row.price)} ${unit}`);
        if (!lines.length && pricing.per_request_price != null) lines.push(`￥${formatPrice(Number(pricing.per_request_price))} / 次`);
        return lines;
    }
    if (pricing.billing_mode === "image") {
        const intervals = (pricing.intervals || []).filter((interval) => interval.per_request_price != null);
        for (const interval of intervals) {
            lines.push(`${interval.tier_label || "标准"} · 每张 ￥${formatPrice(Number(interval.per_request_price))}`);
        }
        if (!lines.length && pricing.per_request_price != null) lines.push(`每张 ￥${formatPrice(Number(pricing.per_request_price))}`);
        return lines;
    }
    if (pricing.input_price != null || pricing.output_price != null) {
        if (pricing.input_price != null) lines.push(`输入：每百万词元 ￥${formatPrice(Number(pricing.input_price) * 1_000_000)}`);
        if (pricing.output_price != null) lines.push(`输出：每百万词元 ￥${formatPrice(Number(pricing.output_price) * 1_000_000)}`);
        return lines;
    }
    const intervals = (pricing.intervals || []).filter((interval) => interval.per_request_price != null);
    for (const interval of intervals) lines.push(`${interval.tier_label || "标准"} · 每次 ￥${formatPrice(Number(interval.per_request_price))}`);
    if (!lines.length && pricing.per_request_price != null) lines.push(`每次 ￥${formatPrice(Number(pricing.per_request_price))}`);
    return lines;
}

function ModelDetailCard({ model }: { model?: CreateModelPlazaModel }) {
    const rawDescription = (model?.description || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
    const video = Boolean(model && isPlazaVideoModel(model));
    const hasChineseDescription = /[\u3400-\u9fff]/.test(rawDescription);
    const description = hasChineseDescription ? rawDescription : model && video ? plazaVideoModelDescription(model) : "该模型暂无中文简介。";
    const lines = model ? priceLines(model) : [];
    const capability = model?.video_capabilities;
    const capabilityLabels = model && video ? plazaVideoCapabilityLabels(model) : [];
    const references = model && video ? plazaVideoReferenceSummary(model) : null;
    const priceRows = model && video ? plazaVideoPricingRows(model) : [];
    const billingUnit = model && video ? plazaVideoBillingUnit(model) : "request";
    const billingLabel = video ? (billingUnit === "second" ? "按秒计费" : "按次计费") : model?.pricing?.billing_mode === "image" ? "按张计费" : model?.pricing?.input_price != null || model?.pricing?.output_price != null ? "按词元计费" : "按次计费";
    const pricePrefix = video ? (billingUnit === "second" ? "每秒" : "每次") : "";
    return (
        <div className="max-h-[68vh] w-[360px] max-w-[min(360px,85vw)] space-y-3 overflow-y-auto pr-1 text-left">
            <p className="whitespace-pre-line break-words text-xs leading-5 text-stone-500 dark:text-stone-300">
                {description || "暂无模型简介"}
            </p>
            {video ? (
                <div className="space-y-2 border-t border-stone-200 pt-2 dark:border-stone-700">
                    {capabilityLabels.length ? (
                        <div className="flex flex-wrap gap-1">
                            {capabilityLabels.map((label) => (
                                <span key={label} className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">{label}</span>
                            ))}
                        </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-5 text-stone-500 dark:text-stone-400">
                        <span>时长：{model ? plazaVideoDurationLabel(model) : "-"}</span>
                        <span>分辨率：{capability?.resolutions?.join(" / ") || "-"}</span>
                        <span>参考图：{references?.images || 0} 张</span>
                        <span>参考视频：{references?.videos || 0} 个</span>
                        <span>参考音频：{references?.audios || 0} 段</span>
                        <span className="col-span-2">计费方式：{billingLabel}</span>
                    </div>
                </div>
            ) : null}
            <div className="space-y-1 border-t border-stone-200 pt-2 dark:border-stone-700">
                <div className="text-[11px] font-medium text-stone-400">价格（{billingLabel}）</div>
                {video && priceRows.length ? (
                    <div className="space-y-1">
                        {priceRows.map((row) => (
                            <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                                <span className="text-stone-500 dark:text-stone-300">{row.resolution}</span>
                                <span className="whitespace-nowrap font-mono text-stone-700 dark:text-stone-200">{pricePrefix} ￥{formatPrice(row.price)}</span>
                            </div>
                        ))}
                    </div>
                ) : lines.length ? (
                    <div className="space-y-1">
                        {lines.map((line) => <div key={line} className="font-mono text-xs text-stone-700 dark:text-stone-200">{line}</div>)}
                    </div>
                ) : <div className="text-xs text-stone-400">暂无价格</div>}
            </div>
        </div>
    );
}

export function WorkbenchModelSelect({ label, value, groups, details, onChange, onEmptyOpen }: WorkbenchModelSelectProps) {
    const options = groups.map((group) => ({
        label: group.name,
        options: group.models,
    }));

    return (
        <Select
            aria-label={label}
            className="workbench-model-select w-full"
            value={value || undefined}
            placeholder="请先配置模型"
            options={options}
            showSearch
            optionFilterProp="label"
            popupMatchSelectWidth={false}
            notFoundContent="暂无云端模型"
            getPopupContainer={() => document.body}
            optionRender={(option) => {
                const data = option.data as unknown as { value: string; label: string };
                return (
                    <Popover
                        placement="rightTop"
                        zIndex={1600}
                        motion={{ motionName: "" }}
                        align={{ offset: [20, 0] }}
                        arrow={false}
                        mouseEnterDelay={0.2}
                        destroyOnHidden
                        content={<ModelDetailCard model={details?.[data.label]} />}
                    >
                        <div className="w-full py-0.5" data-model-option={data.label}>{data.label}</div>
                    </Popover>
                );
            }}
            onOpenChange={(open) => {
                if (open && !groups.length) onEmptyOpen?.();
            }}
            onChange={onChange}
            styles={{ popup: { root: { zIndex: 1400, minWidth: 280, maxWidth: 440 } } }}
        />
    );
}
