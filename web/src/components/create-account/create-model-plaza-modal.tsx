import { App, Input, Modal, Spin, Tag } from "antd";
import { Copy, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCreateModelPlaza, type CreateModelPlaza, type CreateModelPlazaGroup, type CreateModelPlazaModel, type CreateModelPricingInterval } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";
import { plazaVideoCapabilityLabels, plazaVideoReferenceSummary } from "@/lib/plaza-video-model";
import { cn } from "@/lib/utils";

type PriceColumn = { key: string; label: string };
type VideoUnit = "second" | "request";
type VideoPricingRow = { key: string; resolution: string; duration: string; price: number };

export function CreateModelPlazaModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: CreateSession | null }) {
    const { message } = App.useApp();
    const [data, setData] = useState<CreateModelPlaza | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [groupId, setGroupId] = useState("all");
    const [search, setSearch] = useState("");
    const [refreshNonce, setRefreshNonce] = useState(0);

    useEffect(() => {
        if (!open || !session) return;
        let cancelled = false;
        setLoading(true);
        setError("");
        void getCreateModelPlaza(session)
            .then((result) => {
                if (!cancelled) setData(result);
            })
            .catch((cause) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "加载模型广场失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, refreshNonce, session]);

    const groups = data?.groups || [];
    const modelCount = useMemo(() => groups.reduce((total, group) => total + group.models.length, 0), [groups]);
    const filteredGroups = useMemo(() => {
        const query = search.trim().toLowerCase();
        return [...groups]
            .filter((group) => groupId === "all" || String(group.id) === groupId)
            .sort((left, right) => (left.user_rate_multiplier ?? left.rate_multiplier) - (right.user_rate_multiplier ?? right.rate_multiplier) || left.name.localeCompare(right.name))
            .map((group) => ({
                group,
                models: group.models.filter((model) => !query
                    || model.name.toLowerCase().includes(query)
                    || model.platform.toLowerCase().includes(query)
                    || model.description?.toLowerCase().includes(query)),
            }))
            .filter((item) => item.models.length > 0);
    }, [groupId, groups, search]);

    const copyModelName = async (name: string) => {
        try {
            await navigator.clipboard.writeText(name);
            message.success("模型名称已复制");
        } catch {
            message.error("复制模型名称失败");
        }
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={1400}
            title={(
                <div className="flex items-center gap-3 pr-12">
                    <span className="text-2xl font-semibold tracking-tight">模型广场</span>
                    <button
                        type="button"
                        className="grid size-8 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        aria-label="刷新模型广场"
                        title="刷新模型广场"
                        disabled={loading}
                        onClick={() => setRefreshNonce((value) => value + 1)}
                    >
                        <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                    </button>
                </div>
            )}
            styles={{ body: { padding: 0 } }}
            className="model-plaza-modal"
        >
            <div className="flex max-h-[80vh] min-h-[620px] flex-col overflow-hidden">
                <div className="shrink-0 space-y-4 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
                    <div className="flex items-start gap-4">
                        <span className="mt-2 w-12 shrink-0 text-sm text-stone-500 dark:text-stone-400">分组</span>
                        <div className="hide-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                            <FilterChip active={groupId === "all"} label="全部" count={modelCount} onClick={() => setGroupId("all")} />
                            {groups.map((group) => (
                                <FilterChip key={group.id} active={groupId === String(group.id)} label={group.name} count={group.models.length} onClick={() => setGroupId(String(group.id))} />
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="w-12 shrink-0 text-sm text-stone-500 dark:text-stone-400">模型</span>
                        <Input className="h-11 flex-1 rounded-lg" allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索模型名称" value={search} onChange={(event) => setSearch(event.target.value)} />
                    </div>
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {loading ? <div className="flex min-h-[420px] items-center justify-center"><Spin size="large" /></div> : null}
                    {!loading && error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
                    {!loading && !error && !filteredGroups.length ? (
                        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-stone-300 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">没有匹配的模型</div>
                    ) : null}
                    {!loading && !error ? (
                        <div className="space-y-4">
                            {data?.description ? <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-300">{data.description}</p> : null}
                            {filteredGroups.map(({ group, models }) => (
                                <ModelPlazaGroupCard key={group.id} group={group} models={models} onCopy={copyModelName} />
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}

function FilterChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition",
                active
                    ? "border-orange-400 bg-orange-400 text-white shadow-sm"
                    : "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800",
            )}
            onClick={onClick}
        >
            <span>{label}</span>
            <span className={cn("inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 text-xs", active ? "bg-white/20 text-white" : "bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300")}>{count}</span>
        </button>
    );
}

function ModelPlazaGroupCard({ group, models, onCopy }: { group: CreateModelPlazaGroup; models: CreateModelPlazaModel[]; onCopy: (name: string) => void }) {
    const videoModels = models.filter(isVideoPricingModel);
    const standardModels = models.filter((model) => !isVideoPricingModel(model));
    const { requestModels, tokenModels } = splitStandardPricingModels(standardModels);
    const mixedStandardPricing = requestModels.length > 0 && tokenModels.length > 0;
    return (
        <section className="overflow-hidden rounded-xl border border-teal-500/25 bg-white shadow-sm dark:border-teal-700/45 dark:bg-[#252525]">
            <div className="border-b border-stone-200 bg-stone-50/80 px-4 py-4 dark:border-stone-700 dark:bg-[#292929]">
                <div className="inline-flex items-center rounded-md bg-cyan-50 px-2 py-1 text-sm font-medium text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">{group.name}</div>
                {group.description ? <p className="mt-3 text-sm text-stone-500 dark:text-stone-300">{group.description}</p> : null}
            </div>
            {requestModels.length ? (
                <div>
                    {mixedStandardPricing ? <PricingSectionLabel>图片 / 按次计费</PricingSectionLabel> : null}
                    <StandardPricingTable models={requestModels} mode="request" onCopy={onCopy} />
                </div>
            ) : null}
            {tokenModels.length ? (
                <div className={requestModels.length ? "border-t border-stone-200 dark:border-stone-700" : ""}>
                    {mixedStandardPricing ? <PricingSectionLabel>文本 / Token 计费</PricingSectionLabel> : null}
                    <StandardPricingTable models={tokenModels} mode="token" onCopy={onCopy} />
                </div>
            ) : null}
            {videoModels.length ? <VideoPricingCards group={group} models={videoModels} onCopy={onCopy} /> : null}
        </section>
    );
}

function PricingSectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="bg-stone-50/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:bg-stone-900/30 dark:text-stone-400">{children}</div>;
}

function VideoPricingCards({ group, models, onCopy }: { group: CreateModelPlazaGroup; models: CreateModelPlazaModel[]; onCopy: (name: string) => void }) {
    const effectiveRate = group.user_rate_multiplier ?? group.rate_multiplier ?? 1;
    const videoRate = group.video_rate_independent ? Math.max(0, Number(group.video_rate_multiplier ?? 1)) : effectiveRate;
    const rate = Math.max(0, Number(videoRate) || 0);
    return (
        <div className="grid gap-3 p-4 xl:grid-cols-2">
            {models.map((model) => {
                const rows = videoPricingRows(model);
                return (
                    <article key={`${model.platform}:${model.name}`} className="rounded-xl border border-stone-200/80 p-4 dark:border-stone-700/80">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="min-w-0 break-all font-medium text-stone-900 dark:text-white">{model.name}</span>
                                <button type="button" className="shrink-0 rounded p-0.5 text-stone-400 transition hover:bg-stone-100 hover:text-cyan-600 dark:hover:bg-stone-700 dark:hover:text-cyan-400" title="复制模型名称" aria-label={`复制模型名称 ${model.name}`} onClick={() => onCopy(model.name)}>
                                    <Copy className="size-3.5" />
                                </button>
                                <PlatformBadge platform={model.platform} />
                                <BillingBadge model={model} />
                            </div>
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300">
                                可选时长 {videoDurationLabel(model)}
                            </span>
                        </div>
                        {cleanDescription(model.description) ? <p className="mt-2 whitespace-pre-line break-words text-xs leading-5 text-stone-500 dark:text-stone-300">{cleanDescription(model.description)}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {plazaVideoCapabilityLabels(model).map((label) => (
                                <Tag key={label} className="m-0 rounded px-1.5 py-0.5 text-[11px]">{label}</Tag>
                            ))}
                        </div>
                        {(() => {
                            const refs = plazaVideoReferenceSummary(model);
                            return refs.images || refs.videos || refs.audios ? (
                                <p className="mt-2 text-[11px] text-stone-400">
                                    参考素材上限：{refs.images} 图 / {refs.videos} 视频 / {refs.audios} 音频
                                </p>
                            ) : null;
                        })()}
                        {rows.length ? (
                            <div className="mt-2 overflow-x-auto rounded-lg border border-stone-100 dark:border-stone-700/60">
                                <table className="w-full min-w-[420px] table-fixed text-left text-xs">
                                    <thead className="bg-stone-50/80 text-[11px] text-stone-400 dark:bg-stone-900/40">
                                        <tr>
                                            <th className="w-[18%] px-2.5 py-1.5 font-medium">分辨率</th>
                                            <th className="w-[17%] px-2.5 py-1.5 font-medium">计费方式</th>
                                            <th className="w-[18%] px-2.5 py-1.5 font-medium">支持时长</th>
                                            <th className="px-2.5 py-1.5 text-right font-medium">实付价格</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100 dark:divide-stone-700/60">
                                        {rows.map((row) => (
                                            <tr key={row.key}>
                                                <td className="px-2.5 py-2 font-medium text-stone-700 dark:text-stone-100">{row.resolution}</td>
                                                <td className="px-2.5 py-2 text-stone-500 dark:text-stone-400">{videoBillingLabel(model)}</td>
                                                <td className="break-words px-2.5 py-2 text-stone-500 dark:text-stone-400">{row.duration}</td>
                                                <td className="px-2.5 py-2 text-right">
                                                    <div className="font-mono text-sm font-semibold text-stone-900 dark:text-white">
                                                        ￥{formatPrice(row.price * rate)}
                                                        <span className="ml-1 font-sans text-[11px] font-normal text-stone-400">{videoUnitLabel(model)}</span>
                                                    </div>
                                                    {videoBillingUnit(model) === "second" ? <div className="mt-1 break-words text-[10px] leading-4 text-stone-400">{durationEstimates(model, row.price * rate)}</div> : null}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <p className="mt-3 rounded-lg border border-dashed border-stone-200 px-3 py-2 text-xs text-stone-400 dark:border-stone-700">暂无价格</p>}
                    </article>
                );
            })}
        </div>
    );
}

function StandardPricingTable({ models, mode, onCopy }: { models: CreateModelPlazaModel[]; mode: "request" | "token"; onCopy: (name: string) => void }) {
    const columns = mode === "request" ? requestPriceColumns(models) : tokenPriceColumns(models);
    return (
        <div className="overflow-x-auto">
            <div className="border-b border-stone-200 bg-stone-100/80 text-sm text-stone-500 dark:border-stone-700 dark:bg-[#303030] dark:text-stone-300 md:grid md:grid-cols-[minmax(300px,1.15fr)_minmax(440px,1fr)]">
                <div className="flex items-center px-4 py-3 font-medium">模型</div>
                <div className="px-4 py-3">
                    <div className="text-center text-sm font-semibold text-cyan-600 dark:text-cyan-300">
                        实付价格(折后) <span className="font-normal text-stone-500 dark:text-stone-400">{mode === "request" ? "￥ / 次" : "￥ / 1M token"}</span>
                    </div>
                    <div className="mt-2 grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(110px, 1fr))` }}>
                        {columns.map((column) => <span key={column.key} className="text-sm text-stone-500 dark:text-stone-400">{column.label}</span>)}
                    </div>
                </div>
            </div>
            <div>
                {models.map((model, index) => (
                    <div key={`${model.platform}:${model.name}`} className={cn("md:grid md:grid-cols-[minmax(300px,1.15fr)_minmax(440px,1fr)]", index > 0 && "border-t border-stone-200 dark:border-stone-700/80")}>
                        <div className="min-w-0 px-4 py-4">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                                <span className="break-all text-[15px] font-medium text-stone-900 dark:text-stone-100">{model.name}</span>
                                <button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-100" title="复制模型名称" aria-label={`复制模型名称 ${model.name}`} onClick={() => onCopy(model.name)}>
                                    <Copy className="size-3.5" />
                                </button>
                                <PlatformBadge platform={model.platform} />
                                <BillingBadge model={model} />
                            </div>
                            {model.description ? <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{model.description}</p> : null}
                        </div>
                        <div className="grid items-center gap-3 overflow-x-auto px-4 py-4" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(110px, 1fr))` }}>
                            {columns.map((column) => <PriceValue key={column.key} model={model} column={column} />)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PlatformBadge({ platform }: { platform: string }) {
    const normalized = platform.toLowerCase();
    const color = normalized.includes("gemini")
        ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-300"
        : normalized.includes("openai")
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300"
          : normalized.includes("grok")
            ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-300"
            : "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300";
    return <Tag className={cn("m-0 rounded px-1.5 py-0.5 text-xs", color)}>{platformLabel(platform)}</Tag>;
}

function BillingBadge({ model }: { model: CreateModelPlazaModel }) {
    const billingMode = model.pricing?.billing_mode || "";
    const label = billingMode === "image"
        ? "按图片计费"
        : billingMode === "video"
          ? "按秒计费"
          : isTokenPricedModel(model)
            ? "按 Token 计费"
            : "按次计费";
    return (
        <span className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {label}
        </span>
    );
}

function PriceValue({ model, column }: { model: CreateModelPlazaModel; column: PriceColumn }) {
    return <span className="inline-flex min-h-8 w-fit items-center rounded-md border border-stone-200 bg-stone-100 px-2.5 py-1 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300">{priceForModel(model, column)}</span>;
}

export function splitStandardPricingModels(models: CreateModelPlazaModel[]) {
    return {
        requestModels: models.filter(isRequestPricedModel),
        tokenModels: models.filter((model) => !isRequestPricedModel(model)),
    };
}

export function requestPriceColumns(models: CreateModelPlazaModel[]): PriceColumn[] {
    const labels = Array.from(new Set(models.flatMap((model) => (model.pricing?.intervals || [])
        .filter((interval) => pricedValue(interval.per_request_price) != null)
        .map((interval) => interval.tier_label?.trim() || "")
        .filter(Boolean))));
    const columns = labels.map((label) => ({ key: label, label }));
    const hasBasePriceWithoutTier = models.some((model) => {
        const pricing = model.pricing;
        if (!pricing || pricedValue(pricing.per_request_price) == null) return false;
        return !(pricing.intervals || []).some((interval) => pricedValue(interval.per_request_price) != null);
    });
    if (hasBasePriceWithoutTier) columns.unshift({ key: "standard", label: "标准" });
    return columns.length ? columns : [{ key: "standard", label: "标准" }];
}

export function tokenPriceColumns(models: CreateModelPlazaModel[]): PriceColumn[] {
    const labels = Array.from(new Set(models.flatMap((model) => (model.pricing?.intervals || [])
        .filter(hasTokenPrice)
        .map((interval) => interval.tier_label?.trim() || "")
        .filter(Boolean))));
    if (labels.length) return labels.map((label) => ({ key: label, label }));
    return [
        { key: "input", label: "输入" },
        { key: "output", label: "输出" },
        { key: "cache", label: "缓存" },
    ];
}

function priceForModel(model: CreateModelPlazaModel, column: PriceColumn) {
    const pricing = model.pricing;
    if (!pricing) return "-";
    if (column.key === "standard") {
        const price = pricedValue(pricing.per_request_price);
        return price == null ? "-" : `￥${formatPrice(price)} / ${requestUnit(model)}`;
    }
    const interval = findInterval(pricing.intervals || [], column.label);
    if (interval) {
        const tierPrice = pricedValue(interval.per_request_price);
        if (tierPrice != null) return `￥${formatPrice(tierPrice)} / ${requestUnit(model)}`;
        return formatIntervalTokenPrice(interval);
    }
    if (column.key === "input") return formatTokenPrice(pricing.input_price);
    if (column.key === "output") return formatTokenPrice(pricing.output_price);
    if (column.key === "cache") return formatTokenPrice(pricing.cache_read_price);
    return "-";
}

function isRequestPricedModel(model: CreateModelPlazaModel) {
    const pricing = model.pricing;
    if (!pricing) return false;
    const billingMode = pricing.billing_mode?.trim().toLowerCase();
    if (billingMode === "token") return false;
    if (billingMode === "image" || billingMode === "video" || billingMode === "per_request") return true;
    if (isTokenPricedModel(model)) return false;
    if (pricedValue(pricing.per_request_price) != null) return true;
    return (pricing.intervals || []).some((interval) => pricedValue(interval.per_request_price) != null);
}

function isTokenPricedModel(model: CreateModelPlazaModel) {
    const pricing = model.pricing;
    if (!pricing) return false;
    if (pricedValue(pricing.input_price) != null || pricedValue(pricing.output_price) != null || pricedValue(pricing.cache_read_price) != null) return true;
    return (pricing.intervals || []).some(hasTokenPrice);
}

function hasTokenPrice(interval: CreateModelPricingInterval) {
    return pricedValue(interval.input_price) != null
        || pricedValue(interval.output_price) != null
        || pricedValue(interval.cache_read_price) != null
        || pricedValue(interval.cache_write_price) != null;
}

function isVideoPricingModel(model: CreateModelPlazaModel) {
    return model.pricing?.billing_mode === "video" || Boolean(model.video_capabilities);
}

export function videoPricingRows(model: CreateModelPlazaModel): VideoPricingRow[] {
    const intervals = (model.pricing?.intervals || []).filter((interval) => interval.per_request_price != null);
    if (intervals.length) {
        return intervals.map((interval, index) => {
            const tier = splitVideoTierLabel(interval.tier_label || "", interval);
            return {
                key: `${index}:${interval.tier_label || ""}`,
                resolution: tier.resolution,
                duration: videoBillingUnit(model) === "second" ? videoDurationLabel(model) : tier.duration,
                price: Number(interval.per_request_price),
            };
        });
    }
    const price = pricedValue(model.pricing?.per_request_price);
    if (price == null) return [];
    return [{
        key: "standard",
        resolution: "标准",
        duration: videoDurationLabel(model),
        price,
    }];
}

export function videoDurationLabel(model: CreateModelPlazaModel) {
    const capability = model.video_capabilities;
    if (capability?.duration_options?.length) return formatDurationOptions(capability.duration_options);
    const min = Number(capability?.min_duration || 0);
    const max = Number(capability?.max_duration || min || 0);
    if (!min && !max) return "标准";
    return min === max ? `${max}s` : `${min}-${max}s`;
}

function videoBillingUnit(model: CreateModelPlazaModel): VideoUnit {
    return model.pricing?.billing_mode === "video" ? "second" : "request";
}

function videoBillingLabel(model: CreateModelPlazaModel) {
    return videoBillingUnit(model) === "second" ? "按秒计费" : "按次计费";
}

function videoUnitLabel(model: CreateModelPlazaModel) {
    return videoBillingUnit(model) === "second" ? "/ 秒" : "/ 次";
}

function splitVideoTierLabel(label: string, interval: CreateModelPricingInterval) {
    const raw = String(label || "").trim();
    const match = raw.match(/^(.*?)(?:\s*[-_/]?\s*)(\d+)(?:\s*[-_/]\s*(\d+))?s$/i);
    if (match) {
        const start = Number(match[2]);
        const end = match[3] ? Number(match[3]) : start;
        return {
            resolution: (match[1] || "标准").trim().toLowerCase(),
            duration: start === end ? `${start}s` : `${start}-${end}s`,
        };
    }
    const min = Number(interval.min_tokens ?? 0);
    const max = interval.max_tokens == null ? null : Number(interval.max_tokens);
    return {
        resolution: (raw || "标准").toLowerCase(),
        duration: max != null && max > 0 ? (min > 0 && min !== max ? `${min}-${max}s` : `${max}s`) : "标准",
    };
}

function formatDurationOptions(options: number[]) {
    const values = Array.from(new Set(options.filter((value) => Number.isFinite(value) && value > 0))).sort((left, right) => left - right);
    if (!values.length) return "标准";
    const parts: string[] = [];
    for (let index = 0; index < values.length;) {
        let end = index;
        while (end + 1 < values.length && values[end + 1] === values[end] + 1) end += 1;
        if (end - index >= 2) parts.push(`${values[index]}-${values[end]}s`);
        else for (let valueIndex = index; valueIndex <= end; valueIndex += 1) parts.push(`${values[valueIndex]}s`);
        index = end + 1;
    }
    return parts.join(" / ");
}

function durationEstimates(model: CreateModelPlazaModel, secondPrice: number) {
    const capability = model.video_capabilities;
    const values = capability?.duration_options?.length
        ? Array.from(new Set(capability.duration_options)).sort((left, right) => left - right)
        : Array.from(new Set([Number(capability?.min_duration || 0), Number(capability?.max_duration || 0)])).filter((value) => value > 0);
    const preview = values.length > 1 ? [values[0], values[values.length - 1]] : values;
    return preview.map((seconds) => `${seconds}s ≈ ￥${formatPrice(secondPrice * seconds)}`).join(" · ");
}

function cleanDescription(description?: string) {
    return (description || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

function findInterval(intervals: CreateModelPricingInterval[], label: string) {
    return intervals.find((interval) => interval.tier_label?.trim() === label);
}
function formatIntervalTokenPrice(interval: CreateModelPricingInterval) {
    const input = formatTokenPrice(interval.input_price);
    const output = formatTokenPrice(interval.output_price);
    const cache = formatTokenPrice(interval.cache_read_price);
    if (input !== "-" || output !== "-") return [input, output].filter((value) => value !== "-").join(" / ");
    if (cache !== "-") return cache;
    return "-";
}
function formatTokenPrice(value: number | null | undefined) {
    const numeric = pricedValue(value);
    if (numeric == null) return "-";
    return `￥${formatPrice(numeric * 1_000_000)} / 1M`;
}
function pricedValue(value: number | null | undefined) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
function formatPrice(value: number) {
    if (value >= 0.01) return value.toFixed(2).replace(/\.?0+$/, "");
    return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
function requestUnit(model: CreateModelPlazaModel) {
    return model.pricing?.billing_mode === "image" ? "张" : "次";
}
function platformLabel(platform: string) {
    const normalized = platform.toLowerCase();
    if (normalized.includes("gemini")) return "Gemini";
    if (normalized.includes("openai")) return "OpenAI";
    if (normalized.includes("grok")) return "Grok";
    return platform;
}
