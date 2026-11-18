import { Alert, Button, DatePicker, Empty, Input, Modal, Select, Spin, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { CircleDollarSign, Database, ExternalLink, Search, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCreateUsageStats, listCreateUsage, type CreateUsageLog, type CreateUsageStats } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";
import type { CreateManagedKey } from "@/services/create-managed-channel";
import { resolveCreateServiceUrl } from "@/lib/create-product";
import { cn } from "@/lib/utils";
import { getClientRequestTiming } from "@/services/client-request-timing";

export function CreateUsageModal({ open, onClose, session, keys }: { open: boolean; onClose: () => void; session: CreateSession | null; keys: CreateManagedKey[] }) {
    const [logs, setLogs] = useState<CreateUsageLog[]>([]);
    const [stats, setStats] = useState<CreateUsageStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [keyId, setKeyId] = useState("all");
    const [model, setModel] = useState("");
    const [startDate, setStartDate] = useState<Dayjs | null>(() => dayjs().subtract(29, "day"));
    const [endDate, setEndDate] = useState<Dayjs | null>(() => dayjs());

    const load = async () => {
        if (!session) return;
        setLoading(true);
        setError("");
        try {
            const query = {
                apiKeyId: keyId === "all" ? undefined : Number(keyId),
                model,
                startDate: startDate?.format("YYYY-MM-DD"),
                endDate: endDate?.format("YYYY-MM-DD"),
                page: 1,
                pageSize: 100,
            };
            const [page, nextStats] = await Promise.all([listCreateUsage(session, query), getCreateUsageStats(session, query).catch(() => null)]);
            setLogs((page.items || []).filter((item) => item.record_kind !== "error"));
            setStats(nextStats);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "加载使用记录失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) void load();
        // Filters are applied explicitly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, session]);

    const keyNames = useMemo(() => new Map(keys.map((key) => [key.id, key.name])), [keys]);
    const columns = [
        {
            title: "API 密钥",
            dataIndex: "api_key_id",
            width: 140,
            render: (_: number, row: CreateUsageLog) => <span className="font-medium">{row.api_key?.name || keyNames.get(row.api_key_id) || `#${row.api_key_id}`}</span>,
        },
        { title: "模型", dataIndex: "model", width: 200, render: (value: string) => <span className="text-sm font-medium">{value || "-"}</span> },
        {
            title: "分组",
            dataIndex: "group_id",
            width: 115,
            render: (_: number | null, row: CreateUsageLog) =>
                row.group?.name ? <Tag className="m-0 border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-300">{row.group.name}</Tag> : <span>-</span>,
        },
        {
            title: "类型",
            dataIndex: "request_type",
            width: 80,
            render: (value: string) => <Tag className={cn("m-0", requestTypeClass(value))}>{requestTypeLabel(value)}</Tag>,
        },
        {
            title: "计费模式",
            dataIndex: "billing_mode",
            width: 110,
            render: (_: string | null, row: CreateUsageLog) => <Tag className={cn("m-0", billingClass(row))}>{billingLabel(row)}</Tag>,
        },
        {
            title: "价格",
            dataIndex: "actual_cost",
            width: 110,
            render: (value: number) => <span className="font-mono text-sm font-medium text-emerald-600 dark:text-emerald-400">${Number(value || 0).toFixed(6)}</span>,
        },
        {
            title: "图片",
            dataIndex: "image_url",
            width: 130,
            render: (value: string | null) =>
                value ? (
                    <button type="button" className="inline-flex items-center gap-1 text-sm text-orange-600 transition hover:text-orange-500 dark:text-orange-400" onClick={() => openUsageImage(value)}>
                        <ExternalLink className="size-3.5" />
                        打开图片
                        <span className="ml-1 text-stone-500 dark:text-stone-400">原图</span>
                    </button>
                ) : (
                    <span>-</span>
                ),
        },
        {
            title: "延迟",
            key: "latency",
            width: 260,
            render: (_: unknown, row: CreateUsageLog) => <LatencyCell row={row} />,
        },
        {
            title: "时间",
            dataIndex: "created_at",
            width: 190,
            render: (value: string, row: CreateUsageLog) => (
                <div>
                    <div className="text-sm tabular-nums">{formatTime(value)}</div>
                    {row.image_generation_duration_ms ? <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">生成耗时: {formatDuration(row.image_generation_duration_ms)}</div> : null}
                </div>
            ),
        },
    ];

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={1450} title={<span className="text-2xl font-semibold tracking-tight">使用记录</span>} styles={{ body: { padding: 20 } }}>
            <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                    <MetricCard icon={<Database className="size-5" />} iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-300" label="总请求数" value={formatNumber(stats?.total_requests || 0)} hint="所选范围内" />
                    <MetricCard
                        icon={<CircleDollarSign className="size-5" />}
                        iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                        label="总消费"
                        value={`¥${Number(stats?.total_actual_cost || 0).toFixed(4)}`}
                        valueClass="text-emerald-600 dark:text-emerald-400"
                    />
                    <MetricCard icon={<Timer className="size-5" />} iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300" label="平均耗时" value={`${(Number(stats?.average_duration_ms || 0) / 1000).toFixed(2)}s`} />
                </div>

                <div className="grid gap-3 xl:grid-cols-[220px_minmax(260px,1fr)_minmax(380px,1.15fr)_auto] xl:items-end">
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-stone-500 dark:text-stone-400">API 密钥</span>
                        <Select className="w-full" size="large" value={keyId} onChange={setKeyId} options={[{ value: "all", label: "全部密钥" }, ...keys.map((key) => ({ value: String(key.id), label: key.name }))]} />
                    </label>
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-stone-500 dark:text-stone-400">模型</span>
                        <Input className="h-10" value={model} onChange={(event) => setModel(event.target.value)} onPressEnter={() => void load()} placeholder="输入模型名称后回车" />
                    </label>
                    <div>
                        <span className="mb-1.5 block text-sm text-stone-500 dark:text-stone-400">时间范围</span>
                        <div className="flex items-center gap-2">
                            <DatePicker className="min-w-0 flex-1" size="large" value={startDate} onChange={setStartDate} format="YYYY/MM/DD" placeholder="开始日期" />
                            <span className="text-sm text-stone-500">至</span>
                            <DatePicker className="min-w-0 flex-1" size="large" value={endDate} onChange={setEndDate} format="YYYY/MM/DD" placeholder="结束日期" />
                        </div>
                    </div>
                    <Button type="primary" size="large" className="!border-orange-400 !bg-orange-400 !text-white hover:!border-orange-500 hover:!bg-orange-500" icon={<Search className="size-4" />} loading={loading} onClick={() => void load()}>
                        搜索
                    </Button>
                </div>

                {error ? <Alert type="error" showIcon message={error} /> : null}
                <Spin spinning={loading}>
                    <Table<CreateUsageLog>
                        rowKey="id"
                        size="middle"
                        dataSource={logs}
                        columns={columns}
                        pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
                        locale={{ emptyText: <Empty description="暂无使用记录" /> }}
                        scroll={{ x: 1335, y: 540 }}
                        rowClassName="[&>td]:!py-4"
                    />
                </Spin>
            </div>
        </Modal>
    );
}

function MetricCard({ icon, iconClass, label, value, hint, valueClass }: { icon: React.ReactNode; iconClass: string; label: string; value: string; hint?: string; valueClass?: string }) {
    return (
        <div className="flex items-center gap-4 rounded-xl border border-stone-200 bg-stone-50/70 px-5 py-4 dark:border-stone-700 dark:bg-stone-900/40">
            <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", iconClass)}>{icon}</div>
            <div>
                <div className="text-sm text-stone-500 dark:text-stone-400">{label}</div>
                <div className={cn("mt-1 text-2xl font-semibold tabular-nums", valueClass)}>{value}</div>
                {hint ? <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-500">{hint}</div> : null}
            </div>
        </div>
    );
}

function LatencyCell({ row }: { row: CreateUsageLog }) {
    const seconds = Number(row.duration_ms || 0) / 1000;
    const tps = seconds > 0 && Number(row.output_tokens || 0) > 0 ? (Number(row.output_tokens) / seconds).toFixed(1) : "-";
    const clientTiming = getClientRequestTiming(row.request_id);
    const sentMs = clientTiming?.generationMs ?? Number(row.duration_ms || 0);
    return (
        <div className="flex gap-2">
            <span className="w-0.5 shrink-0 rounded bg-emerald-500/70" />
            <div className="min-w-0 space-y-1 text-xs">
                <div className="flex gap-2">
                    <span className="w-12 text-stone-500 dark:text-stone-400">首字</span>
                    <span>{formatDuration(row.first_token_ms)}</span>
                </div>
                <div className="flex gap-2">
                    <span className="w-16 text-stone-500 dark:text-stone-400">发送后</span>
                    <span className="text-orange-600 dark:text-orange-400">{formatDuration(sentMs)}</span>
                </div>
                <div className="flex gap-2">
                    <span className="w-16 text-stone-500 dark:text-stone-400">从压缩开始</span>
                    <span>{clientTiming ? formatDuration(clientTiming.totalMs) : "-"}</span>
                </div>
                <div className="flex gap-2">
                    <span className="w-16 text-stone-500 dark:text-stone-400">压缩耗时</span>
                    <span>{clientTiming ? formatDuration(clientTiming.prepareMs) : "-"}</span>
                </div>
                <div className="flex gap-2">
                    <span className="w-16 text-stone-500 dark:text-stone-400">下载耗时</span>
                    <span>{clientTiming && clientTiming.downloadMs > 0 ? formatDuration(clientTiming.downloadMs) : "-"}</span>
                </div>
                <div className="flex gap-2">
                    <span className="w-12 text-stone-500 dark:text-stone-400">输出 TPS</span>
                    <span>{tps}</span>
                </div>
            </div>
        </div>
    );
}

function requestTypeLabel(value?: string | null) {
    if (value === "async") return "异步";
    if (value === "sync") return "同步";
    if (value === "stream") return "流式";
    return value || "请求";
}

function requestTypeClass(value?: string | null) {
    if (value === "async") return "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800/60 dark:bg-cyan-950/50 dark:text-cyan-300";
    if (value === "stream") return "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-300";
    return "border-stone-300 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

function billingLabel(row: CreateUsageLog) {
    if (row.billing_mode === "image") return "按次(图片)";
    if (row.billing_mode === "video") return "按次(视频)";
    return "按量(Token)";
}

function billingClass(row: CreateUsageLog) {
    if (row.billing_mode === "image") return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300";
    if (row.billing_mode === "video") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
    return "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-300";
}

function openUsageImage(value: string) {
    const resolved = resolveCreateServiceUrl(value);
    const absolute = /^https?:\/\//i.test(resolved) ? resolved : new URL(resolved, window.location.origin).toString();
    const bridge = (window as Window & { createDesktop?: { openExternal?: (url: string) => Promise<void> } }).createDesktop;
    if (bridge?.openExternal) void bridge.openExternal(absolute);
    else window.open(absolute, "_blank", "noopener,noreferrer");
}

function formatTime(value: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function formatDuration(value?: number | null) {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return "-";
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${(seconds % 60).toFixed(0)}s`;
}

function formatNumber(value: number) {
    return Number(value || 0).toLocaleString("zh-CN");
}
