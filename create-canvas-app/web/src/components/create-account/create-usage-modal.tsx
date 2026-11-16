import { Alert, Button, Empty, Input, Modal, Select, Spin, Table, Tag } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCreateUsageStats, listCreateUsage, type CreateUsageLog, type CreateUsageStats } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";
import type { CreateManagedKey } from "@/services/create-managed-channel";

export function CreateUsageModal({
    open,
    onClose,
    session,
    keys,
}: {
    open: boolean;
    onClose: () => void;
    session: CreateSession | null;
    keys: CreateManagedKey[];
}) {
    const [logs, setLogs] = useState<CreateUsageLog[]>([]);
    const [stats, setStats] = useState<CreateUsageStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [keyId, setKeyId] = useState("all");
    const [model, setModel] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    const load = async () => {
        if (!session) return;
        setLoading(true);
        setError("");
        try {
            const query = {
                apiKeyId: keyId === "all" ? undefined : Number(keyId),
                model,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
                page: 1,
                pageSize: 50,
            };
            const [page, nextStats] = await Promise.all([
                listCreateUsage(session, query),
                getCreateUsageStats(session, query).catch(() => null),
            ]);
            setLogs(page.items || []);
            setStats(nextStats);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "加载使用记录失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) void load();
        // Load when opened; filters are applied explicitly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, session]);

    const keyNames = useMemo(() => new Map(keys.map((key) => [key.id, key.name])), [keys]);
    const columns = [
        { title: "API 密钥", dataIndex: "api_key_id", width: 160, render: (id: number) => keyNames.get(id) || `#${id}` },
        { title: "模型", dataIndex: "model", width: 180 },
        { title: "分组", dataIndex: "group_id", width: 140, render: (id: number | null) => keys.find((key) => key.group_id === id)?.group?.name || (id ? `#${id}` : "-") },
        { title: "类型", dataIndex: "stream", width: 88, render: (stream: boolean) => <Tag>{stream ? "流式" : "请求"}</Tag> },
        { title: "价格", dataIndex: "actual_cost", width: 100, render: (value: number) => `$${Number(value || 0).toFixed(4)}` },
        { title: "模型输出", dataIndex: "total_tokens", width: 100, render: (_: number, row: CreateUsageLog) => `${Number(row.input_tokens || 0) + Number(row.output_tokens || 0)}` },
        { title: "时间", dataIndex: "created_at", width: 180, render: (value: string) => formatTime(value) },
    ];

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={1100} title="使用记录">
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="请求数" value={String(stats?.total_requests || 0)} />
                <Metric label="Tokens" value={formatNumber(stats?.total_tokens || 0)} />
                <Metric label="标准费用" value={`$${Number(stats?.total_cost || 0).toFixed(4)}`} />
                <Metric label="实际扣费" value={`$${Number(stats?.total_actual_cost || 0).toFixed(4)}`} />
            </div>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="w-44 text-xs text-stone-500">API 密钥<Select className="mt-1 w-full" value={keyId} onChange={setKeyId} options={[{ value: "all", label: "全部密钥" }, ...keys.map((key) => ({ value: String(key.id), label: key.name }))]} /></label>
                <label className="min-w-48 flex-1 text-xs text-stone-500">模型<Input className="mt-1" value={model} onChange={(event) => setModel(event.target.value)} onPressEnter={() => void load()} placeholder="输入模型名称" /></label>
                <label className="text-xs text-stone-500">开始日期<Input className="mt-1" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
                <label className="text-xs text-stone-500">结束日期<Input className="mt-1" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
                <Button type="primary" icon={<Search className="size-4" />} loading={loading} onClick={() => void load()}>搜索</Button>
            </div>
            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
            <Spin spinning={loading}>
                <Table<CreateUsageLog> rowKey="id" size="small" columns={columns} dataSource={logs} pagination={{ pageSize: 20, showSizeChanger: false }} locale={{ emptyText: <Empty description="暂无使用记录" /> }} scroll={{ x: 950 }} />
            </Spin>
            <div className="mt-3 flex justify-end"><Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>刷新</Button></div>
        </Modal>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
