import { Alert, Input, Modal, Select, Spin, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { getCreateModelPlaza, type CreateModelPlaza, type CreateModelPlazaGroup, type CreateModelPlazaModel } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";

type PlazaRow = { key: string; group: CreateModelPlazaGroup; model: CreateModelPlazaModel };

export function CreateModelPlazaModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: CreateSession | null }) {
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
            .then((result) => { if (!cancelled) setData(result); })
            .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "加载模型广场失败"); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, session]);

    const rows = useMemo<PlazaRow[]>(() => (data?.groups || []).flatMap((group) => group.models.map((model) => ({ key: `${group.id}:${model.platform}:${model.name}`, group, model }))), [data]);
    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (groupId !== "all" && String(row.group.id) !== groupId) return false;
            if (!query) return true;
            return row.model.name.toLowerCase().includes(query) || row.model.platform.toLowerCase().includes(query) || row.group.name.toLowerCase().includes(query);
        });
    }, [groupId, rows, search]);

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={1120} title="模型广场">
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Select className="w-56" value={groupId} onChange={setGroupId} options={[{ value: "all", label: "全部分组" }, ...(data?.groups || []).map((group) => ({ value: String(group.id), label: group.name }))]} />
                <Input.Search className="max-w-sm flex-1" allowClear placeholder="搜索模型、平台或分组" value={search} onChange={(event) => setSearch(event.target.value)} />
                <span className="text-xs text-stone-500">共 {filteredRows.length} 个模型</span>
            </div>
            {data?.description ? <Alert className="mb-4" type="info" showIcon message={data.description} /> : null}
            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
            <Spin spinning={loading}>
                <Table<PlazaRow>
                    rowKey="key" size="small" dataSource={filteredRows}
                    pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 900, y: 520 }}
                    columns={[
                        { title: "分组", width: 150, render: (_: unknown, row: PlazaRow) => row.group.name },
                        { title: "模型", width: 260, render: (_: unknown, row: PlazaRow) => <span className="font-mono text-xs">{row.model.name}</span> },
                        { title: "平台", width: 110, render: (_: unknown, row: PlazaRow) => <Tag>{row.model.platform}</Tag> },
                        { title: "倍率", width: 90, render: (_: unknown, row: PlazaRow) => `${row.group.user_rate_multiplier ?? row.group.rate_multiplier}x` },
                        { title: "价格", render: (_: unknown, row: PlazaRow) => formatModelPrice(row.model) },
                    ]}
                />
            </Spin>
        </Modal>
    );
}

function formatModelPrice(model: CreateModelPlazaModel) {
    const pricing = model.pricing;
    if (!pricing) return "-";
    if (Number(pricing.per_request_price || 0) > 0) return `$${Number(pricing.per_request_price).toFixed(4)} / 次`;
    const input = Number(pricing.input_price || 0) * 1_000_000;
    const output = Number(pricing.output_price || 0) * 1_000_000;
    if (input > 0 || output > 0) return `输入 $${input.toFixed(4)} / 1M · 输出 $${output.toFixed(4)} / 1M`;
    const imageInput = Number(pricing.image_input_price || 0) * 1_000_000;
    const imageOutput = Number(pricing.image_output_price || 0) * 1_000_000;
    if (imageInput > 0 || imageOutput > 0) return `图片输入 $${imageInput.toFixed(4)} / 1M · 图片输出 $${imageOutput.toFixed(4)} / 1M`;
    return pricing.billing_mode || "-";
}
