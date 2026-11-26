import { App, Input, Modal, Spin, Tag } from "antd";
import { Copy, RefreshCw, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCreateImageModelPerformance, getCreateModelPlaza, getCreateVideoModelPerformance, type CreateImagePerformanceModel, type CreateModelPlaza, type CreateModelPlazaGroup, type CreateModelPlazaModel, type CreateModelPricingInterval, type CreateVideoPerformanceModel } from "@/services/create-account";
import { buildImagePerformanceMap, buildPerformanceBars, buildVideoPerformanceMap, findImagePerformance, formatPerformanceDuration, formatPerformanceRate, performanceColor, performanceLevel, videoVendorLabel } from "@/lib/plaza-performance";
import type { CreateSession } from "@/services/create-auth";
import { plazaVideoCapabilityLabels, plazaVideoReferenceSummary } from "@/lib/plaza-video-model";
import { cn } from "@/lib/utils";
import { publicAsset } from "@/lib/managed-mode";

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
    const [imagePerformance24h, setImagePerformance24h] = useState<CreateImagePerformanceModel[]>([]);
    const [imagePerformance7d, setImagePerformance7d] = useState<CreateImagePerformanceModel[]>([]);
    const [imagePerformanceEndAt, setImagePerformanceEndAt] = useState("");
    const [videoPerformance, setVideoPerformance] = useState<CreateVideoPerformanceModel[]>([]);
    const [videoPerformanceRefreshedAt, setVideoPerformanceRefreshedAt] = useState("");

    useEffect(() => {
        if (!open || !session) return;
        let cancelled = false;
        setLoading(true);
        setError("");
        void Promise.all([
            getCreateModelPlaza(session),
            Promise.allSettled([
                getCreateImageModelPerformance(session, "24h"),
                getCreateImageModelPerformance(session, "7d"),
                getCreateVideoModelPerformance(session),
            ]),
        ])
            .then(([result, performance]) => {
                if (cancelled) return;
                setData(result);
                const [image24, image7d, video] = performance;
                if (image24.status === "fulfilled") {
                    setImagePerformance24h(image24.value.models || []);
                    setImagePerformanceEndAt(image24.value.end_at || "");
                } else {
                    setImagePerformance24h([]);
                    setImagePerformanceEndAt("");
                }
                setImagePerformance7d(image7d.status === "fulfilled" ? image7d.value.models || [] : []);
                if (video.status === "fulfilled") {
                    setVideoPerformance(video.value.models || []);
                    setVideoPerformanceRefreshedAt(video.value.refreshed_at || "");
                } else {
                    setVideoPerformance([]);
                    setVideoPerformanceRefreshedAt("");
                }
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
    const imagePerformance24hMap = useMemo(() => buildImagePerformanceMap(imagePerformance24h), [imagePerformance24h]);
    const imagePerformance7dMap = useMemo(() => buildImagePerformanceMap(imagePerformance7d), [imagePerformance7d]);
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
                                <ModelPlazaGroupCard key={group.id} group={group} models={models} onCopy={copyModelName} imagePerformance24h={imagePerformance24hMap} imagePerformance7d={imagePerformance7dMap} imagePerformanceEndAt={imagePerformanceEndAt} videoPerformance={videoPerformance} videoPerformanceRefreshedAt={videoPerformanceRefreshedAt} />
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

function ModelPlazaGroupCard({ group, models, onCopy, imagePerformance24h, imagePerformance7d, imagePerformanceEndAt, videoPerformance, videoPerformanceRefreshedAt }: { group: CreateModelPlazaGroup; models: CreateModelPlazaModel[]; onCopy: (name: string) => void; imagePerformance24h: Map<string, CreateImagePerformanceModel>; imagePerformance7d: Map<string, CreateImagePerformanceModel>; imagePerformanceEndAt: string; videoPerformance: CreateVideoPerformanceModel[]; videoPerformanceRefreshedAt: string }) {
    const videoModels = models.filter(isVideoPricingModel);
    const standardModels = models.filter((model) => !isVideoPricingModel(model));
    const { requestModels, tokenModels } = splitStandardPricingModels(standardModels);
    const imageModels = requestModels.filter(isImagePricingModel);
    const otherRequestModels = requestModels.filter((model) => !isImagePricingModel(model));
    const mixedStandardPricing = otherRequestModels.length > 0 && tokenModels.length > 0;
    return (
        <section className="overflow-hidden rounded-xl border border-teal-500/25 bg-white shadow-sm dark:border-teal-700/45 dark:bg-[#252525]">
            <div className="border-b border-stone-200 bg-stone-50/80 px-4 py-4 dark:border-stone-700 dark:bg-[#292929]">
                <div className="inline-flex items-center rounded-md bg-cyan-50 px-2 py-1 text-sm font-medium text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">{group.name}</div>
                {group.description ? <p className="mt-3 text-sm text-stone-500 dark:text-stone-300">{group.description}</p> : null}
            </div>
            {imageModels.length ? (
                <ImagePricingCards group={group} models={imageModels} onCopy={onCopy} imagePerformance24h={imagePerformance24h} imagePerformance7d={imagePerformance7d} imagePerformanceEndAt={imagePerformanceEndAt} />
            ) : null}
            {otherRequestModels.length ? (
                <div>
                    {mixedStandardPricing ? <PricingSectionLabel>按次计费</PricingSectionLabel> : null}
                    <StandardPricingTable models={otherRequestModels} mode="request" onCopy={onCopy} />
                </div>
            ) : null}
            {tokenModels.length ? (
                <div className={otherRequestModels.length ? "border-t border-stone-200 dark:border-stone-700" : ""}>
                    {mixedStandardPricing ? <PricingSectionLabel>文本 / Token 计费</PricingSectionLabel> : null}
                    <StandardPricingTable models={tokenModels} mode="token" onCopy={onCopy} />
                </div>
            ) : null}
            {videoModels.length ? <VideoPricingCards group={group} models={videoModels} onCopy={onCopy} videoPerformance={videoPerformance} videoPerformanceRefreshedAt={videoPerformanceRefreshedAt} /> : null}
        </section>
    );
}

function PricingSectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="bg-stone-50/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:bg-stone-900/30 dark:text-stone-400">{children}</div>;
}

function ImagePricingCards({ group, models, onCopy, imagePerformance24h, imagePerformance7d, imagePerformanceEndAt }: { group: CreateModelPlazaGroup; models: CreateModelPlazaModel[]; onCopy: (name: string) => void; imagePerformance24h: Map<string, CreateImagePerformanceModel>; imagePerformance7d: Map<string, CreateImagePerformanceModel>; imagePerformanceEndAt: string }) {
    const effectiveRate = group.user_rate_multiplier ?? group.rate_multiplier ?? 1;
    const imageRate = group.image_rate_independent ? Math.max(0, Number(group.image_rate_multiplier ?? 1)) : effectiveRate;
    return (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
            {models.map((model) => (
                <ImagePricingCard
                    key={`${model.platform}:${model.name}`}
                    model={model}
                    rate={Math.max(0, Number(imageRate) || 0)}
                    onCopy={onCopy}
                    performance24h={findImagePerformance(imagePerformance24h, group.id, model.name)}
                    performance7d={findImagePerformance(imagePerformance7d, group.id, model.name)}
                    performanceEndAt={imagePerformanceEndAt}
                />
            ))}
        </div>
    );
}

function ImagePricingCard({ model, rate, onCopy, performance24h, performance7d, performanceEndAt }: { model: CreateModelPlazaModel; rate: number; onCopy: (name: string) => void; performance24h: CreateImagePerformanceModel | null; performance7d: CreateImagePerformanceModel | null; performanceEndAt: string }) {
    const [expanded, setExpanded] = useState(false);
    const interval = model.pricing?.intervals?.find((item) => item.per_request_price != null);
    const requestPrice = interval?.per_request_price ?? model.pricing?.per_request_price;
    const price = requestPrice == null ? "-" : `¥${formatPrice(requestPrice * rate)} / 张`;
    const icon = imageModelIcon(model.name);
    return (
        <article className="grid min-w-0 grid-cols-[82px_minmax(0,1fr)] gap-4 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm transition hover:border-stone-300 hover:shadow-md dark:border-stone-700/80 dark:bg-stone-800/35 dark:hover:border-stone-600">
            <div className="flex justify-center pt-1">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-stone-50 ring-1 ring-stone-100 dark:bg-stone-700/50 dark:ring-stone-700">
                    {icon ? <img src={icon} alt="" className={cn("size-11", /openai/i.test(icon) && "dark:invert")} /> : <Sparkles className="size-11 text-stone-500 dark:text-stone-300" />}
                </span>
            </div>
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-base font-semibold text-stone-900 dark:text-white">{model.name}</span>
                    <button type="button" className="shrink-0 rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-cyan-600 dark:hover:bg-stone-700 dark:hover:text-cyan-400" title="复制模型名称" aria-label={`复制模型名称 ${model.name}`} onClick={() => onCopy(model.name)}>
                        <Copy className="size-3.5" />
                    </button>
                </div>
                <div className="mt-1 text-xs text-stone-400">按图片计费 <strong className="ml-1 font-mono text-sm font-semibold text-stone-700 dark:text-stone-200">{price}</strong></div>
                <ImagePricingPerformance metric24h={performance24h} metric7d={performance7d} endAt={performanceEndAt} />
                <div className="mt-1 flex justify-end">
                    <button type="button" className="text-xs font-medium text-stone-500 hover:text-cyan-600 dark:text-stone-300 dark:hover:text-cyan-400" onClick={() => setExpanded((value) => !value)}>
                        详情 <span aria-hidden="true">{expanded ? "⌃" : "›"}</span>
                    </button>
                </div>
                {expanded ? (
                    <div className="mt-2 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-300">
                        {cleanDescription(model.description) || "暂无模型说明"}
                        {(model.pricing?.intervals || []).filter((item) => item.per_request_price != null).map((item) => (
                            <div key={item.tier_label || item.per_request_price || "tier"} className="mt-1 flex justify-between gap-3">
                                <span>{item.tier_label || "标准"}</span>
                                <span>¥{formatPrice(Number(item.per_request_price) * rate)} / 张</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function ImagePricingPerformance({ metric24h, metric7d, endAt }: { metric24h: CreateImagePerformanceModel | null; metric7d: CreateImagePerformanceModel | null; endAt: string }) {
    const bars = buildPerformanceBars(metric24h, endAt);
    const metricText = (metric: CreateImagePerformanceModel | null) => metric?.success_rate == null
        ? "数据不足 · 数据不足"
        : `${formatPerformanceRate(metric.success_rate)} · ${formatPerformanceDuration(metric.avg_duration_ms)}`;
    return (
        <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-700/60">
            <div className="flex items-center gap-3">
                <span className="shrink-0 whitespace-nowrap text-[11px] text-stone-400">近24小时（每小时）</span>
                <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                    {bars.map((bar) => {
                        const level = performanceLevel(bar.rate);
                        return <span key={bar.key} className="h-3.5 min-w-0 rounded-[2px]" style={{ backgroundColor: performanceColor(level) }} title={`${new Date(bar.key).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · ${formatPerformanceRate(bar.rate)}`} />;
                    })}
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
                <div><div className="text-[11px] text-stone-400">24小时 成功率/耗时</div><div className="mt-1 whitespace-nowrap text-sm font-semibold text-stone-700 dark:text-stone-200">{metricText(metric24h)}</div></div>
                <div><div className="text-[11px] text-stone-400">7天 成功率/耗时</div><div className="mt-1 whitespace-nowrap text-sm font-semibold text-stone-700 dark:text-stone-200">{metricText(metric7d)}</div></div>
            </div>
        </div>
    );
}
function VideoPricingCards({ group, models, onCopy, videoPerformance, videoPerformanceRefreshedAt }: { group: CreateModelPlazaGroup; models: CreateModelPlazaModel[]; onCopy: (name: string) => void; videoPerformance: CreateVideoPerformanceModel[]; videoPerformanceRefreshedAt: string }) {
    const videoPerformanceMap = buildVideoPerformanceMap(videoPerformance);
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
                                <VendorBadge model={model.name} />
                                <BillingBadge model={model} />
                            </div>
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300">
                                可选时长 {videoDurationLabel(model)}
                            </span>
                        </div>
                        {cleanDescription(model.description) ? <p className="mt-2 whitespace-pre-line break-words text-xs leading-5 text-stone-500 dark:text-stone-300">{cleanDescription(model.description)}</p> : null}
                        <ModelPerformancePanel metric24h={videoPerformanceMap.get(model.name.trim().toLowerCase())?.last_24h} metric7d={videoPerformanceMap.get(model.name.trim().toLowerCase())?.last_7d} endAt={videoPerformanceRefreshedAt} />
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

type PerformanceMetricLike = {
    success_rate: number | null;
    avg_latency_ms?: number | null;
    avg_duration_ms?: number | null;
    series?: Array<{ bucket_start: string; success_rate: number | null }> | null;
};

function ModelPerformancePanel({ metric24h, metric7d, endAt }: { metric24h: PerformanceMetricLike | null | undefined; metric7d: PerformanceMetricLike | null | undefined; endAt: string }) {
    const bars = buildPerformanceBars(metric24h, endAt);
    const metricText = (metric: PerformanceMetricLike | null | undefined) => `${formatPerformanceRate(metric?.success_rate)} · ${formatPerformanceDuration(metric?.avg_latency_ms ?? metric?.avg_duration_ms)}`;
    return (
        <div className="mt-3 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5 dark:border-stone-700/60 dark:bg-stone-900/30">
            <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] text-stone-400">24h</span>
                <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                    {bars.map((bar) => {
                        const level = performanceLevel(bar.rate);
                        return <span key={bar.key} className="h-3 min-w-0 rounded-[2px]" style={{ backgroundColor: performanceColor(level) }} title={`${new Date(bar.key).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · ${formatPerformanceRate(bar.rate)}`} />;
                    })}
                </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-stone-400">24小时 </span><span className="font-medium text-stone-700 dark:text-stone-200">{metricText(metric24h)}</span></div>
                <div><span className="text-stone-400">7天 </span><span className="font-medium text-stone-700 dark:text-stone-200">{metricText(metric7d)}</span></div>
            </div>
        </div>
    );
}

function VendorBadge({ model }: { model: string }) {
    return <Tag className="m-0 rounded border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300">{videoVendorLabel(model)}</Tag>;
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

function isImagePricingModel(model: CreateModelPlazaModel) {
    if (model.pricing?.billing_mode === "image") return true;
    const name = model.name.toLowerCase();
    return name.includes("image") || name.includes("banana") || name.includes("imagen") || name.includes("seedream") || name.includes("flux") || name.includes("sdxl");
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
function imageModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("gpt") || name.includes("openai") || name.includes("dall-e")) return publicAsset("icons/openai.svg");
    if (name.includes("gemini") || name.includes("banana") || name.includes("google") || name.includes("imagen")) return publicAsset("icons/gemini.svg");
    if (name.includes("grok")) return publicAsset("icons/grok.svg");
    if (name.includes("claude") || name.includes("anthropic")) return publicAsset("icons/claude.svg");
    if (name.includes("deepseek")) return publicAsset("icons/deepseek.svg");
    if (name.includes("glm")) return publicAsset("icons/glm.svg");
    return "";
}
function platformLabel(platform: string) {
    const normalized = platform.toLowerCase();
    if (normalized.includes("gemini")) return "Gemini";
    if (normalized.includes("openai")) return "OpenAI";
    if (normalized.includes("grok")) return "Grok";
    return platform;
}
