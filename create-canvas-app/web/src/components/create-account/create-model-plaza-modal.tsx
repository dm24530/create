import { App, Input, Modal, Spin, Tag } from "antd";
import { Copy, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCreateModelPlaza, type CreateModelPlaza, type CreateModelPlazaGroup, type CreateModelPlazaModel, type CreateModelPricing, type CreateModelPricingInterval } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";
import { cn } from "@/lib/utils";

type PriceColumn = { key: string; label: string };

export function CreateModelPlazaModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: CreateSession | null }) {
    const { message } = App.useApp();
    const [data, setData] = useState<CreateModelPlaza | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [groupId, setGroupId] = useState("all");
    const [search, setSearch] = useState("");

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
    }, [open, session]);

    const groups = data?.groups || [];
    const modelCount = useMemo(() => groups.reduce((total, group) => total + group.models.length, 0), [groups]);
    const filteredGroups = useMemo(() => {
        const query = search.trim().toLowerCase();
        return groups
            .filter((group) => groupId === "all" || String(group.id) === groupId)
            .map((group) => ({ group, models: group.models.filter((model) => !query || model.name.toLowerCase().includes(query) || model.platform.toLowerCase().includes(query)) }))
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
        <Modal open={open} onCancel={onClose} footer={null} width={1400} title={<span className="text-2xl font-semibold tracking-tight">模型广场</span>} styles={{ body: { padding: 0 } }} className="model-plaza-modal">
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
                    {loading ? (
                        <div className="flex min-h-[420px] items-center justify-center">
                            <Spin size="large" />
                        </div>
                    ) : null}
                    {!loading && error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
                    {!loading && !error && !filteredGroups.length ? (
                        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-stone-300 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">没有匹配的模型</div>
                    ) : null}
                    {!loading && !error ? (
                        <div className="space-y-4">
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
    const columns = priceColumns(models);
    return (
        <section className="overflow-hidden rounded-xl border border-teal-500/25 bg-white shadow-sm dark:border-teal-700/45 dark:bg-[#252525]">
            <div className="border-b border-stone-200 bg-stone-50/80 px-4 py-4 dark:border-stone-700 dark:bg-[#292929]">
                <div className="inline-flex items-center rounded-md bg-cyan-50 px-2 py-1 text-sm font-medium text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">{group.name}</div>
                {group.description ? <p className="mt-3 text-sm text-stone-500 dark:text-stone-300">{group.description}</p> : null}
            </div>
            <div className="grid border-b border-stone-200 bg-stone-100/80 text-sm text-stone-500 dark:border-stone-700 dark:bg-[#303030] dark:text-stone-300 md:grid-cols-[minmax(300px,1.15fr)_minmax(440px,1fr)]">
                <div className="flex items-center px-4 py-3 font-medium">模型</div>
                <div className="px-4 py-3">
                    <div className="text-center text-sm font-semibold text-cyan-600 dark:text-cyan-300">
                        实付价格(折后) <span className="font-normal text-stone-500 dark:text-stone-400">$ / 1M token</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3">
                        {columns.map((column) => (
                            <span key={column.key} className="text-sm text-stone-500 dark:text-stone-400">
                                {column.label}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <div>
                {models.map((model, index) => (
                    <div key={`${model.platform}:${model.name}`} className={cn("grid md:grid-cols-[minmax(300px,1.15fr)_minmax(440px,1fr)]", index > 0 && "border-t border-stone-200 dark:border-stone-700/80")}>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 px-4 py-4">
                            <span className="break-all text-[15px] font-medium text-stone-900 dark:text-stone-100">{model.name}</span>
                            <button
                                type="button"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                                title="复制模型名称"
                                aria-label={`复制模型名称 ${model.name}`}
                                onClick={() => onCopy(model.name)}
                            >
                                <Copy className="size-3.5" />
                            </button>
                            <PlatformBadge platform={model.platform} />
                            <BillingBadge model={model} />
                        </div>
                        <div className="grid grid-cols-3 items-center gap-3 px-4 py-4">
                            {columns.map((column) => (
                                <PriceValue key={column.key} model={model} column={column} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
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
    return (
        <span className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {billingMode === "image" ? "按图片计费" : billingMode === "video" ? "按视频计费" : "按 Token 计费"}
        </span>
    );
}

function PriceValue({ model, column }: { model: CreateModelPlazaModel; column: PriceColumn }) {
    return <span className="inline-flex min-h-8 w-fit items-center rounded-md border border-stone-200 bg-stone-100 px-2.5 py-1 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300">{priceForModel(model, column)}</span>;
}

function priceColumns(models: CreateModelPlazaModel[]): PriceColumn[] {
    const labels = Array.from(new Set(models.flatMap((model) => (model.pricing?.intervals || []).map((interval) => interval.tier_label?.trim() || "").filter(Boolean)))).slice(0, 3);
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
    const interval = findInterval(pricing.intervals || [], column.label);
    if (interval) {
        const tierPrice = pricedValue(interval.per_request_price) ?? pricedValue(pricing.per_request_price);
        if (tierPrice != null) return `$${formatPrice(tierPrice)} / ${requestUnit(model)}`;
        return formatIntervalTokenPrice(interval);
    }
    if (column.key === "input") return formatTokenPrice(pricing.input_price);
    if (column.key === "output") return formatTokenPrice(pricing.output_price);
    if (column.key === "cache") return formatTokenPrice(pricing.cache_read_price);
    return "-";
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
    return `$${formatPrice(numeric * 1_000_000)} / 1M`;
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
