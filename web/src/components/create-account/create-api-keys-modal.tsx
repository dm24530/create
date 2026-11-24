import { Alert, App, Button, Input, InputNumber, Modal, Select, Spin } from "antd";
import { Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { CreateSession } from "@/services/create-auth";
import { createCreateManagedKey, deleteCreateManagedKey, listCreateManagedGroups, managedKeySupportsImage, managedKeySupportsVideo, updateCreateManagedKey, type CreateManagedGroup, type CreateManagedKey } from "@/services/create-managed-channel";
import { cn } from "@/lib/utils";

type KeyFormState = {
    name: string;
    groupId: number | null;
    quota: number | null;
    expiresInDays: number | null;
    rateLimit5h: number | null;
    rateLimit1d: number | null;
    rateLimit7d: number | null;
};

const EMPTY_FORM: KeyFormState = {
    name: "",
    groupId: null,
    quota: null,
    expiresInDays: null,
    rateLimit5h: null,
    rateLimit1d: null,
    rateLimit7d: null,
};

export function CreateApiKeysModal({ open, onClose, session, keys, loading, onRefresh }: { open: boolean; onClose: () => void; session: CreateSession | null; keys: CreateManagedKey[]; loading: boolean; onRefresh: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [groups, setGroups] = useState<CreateManagedGroup[]>([]);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingKey, setEditingKey] = useState<CreateManagedKey | null>(null);
    const [form, setForm] = useState<KeyFormState>(EMPTY_FORM);
    const [formError, setFormError] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open || !session) return;
        let cancelled = false;
        setGroupsLoading(true);
        void listCreateManagedGroups(session)
            .then((available) => {
                if (!cancelled) setGroups(available);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "加载模型分组失败");
            })
            .finally(() => {
                if (!cancelled) setGroupsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message, open, session]);

    const copyKey = async (item: CreateManagedKey) => {
        try {
            await navigator.clipboard.writeText(item.key);
            setCopiedId(item.id);
            message.success("API 密钥已复制");
            window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1600);
        } catch {
            message.error("复制密钥失败");
        }
    };

    const openCreateForm = () => {
        const preferred = groups.find((group) => group.platform === "composite") || groups.find((group) => managedKeySupportsImage(group)) || groups[0];
        setEditingKey(null);
        setForm({ ...EMPTY_FORM, name: nextKeyName(keys), groupId: preferred?.id ?? null });
        setFormError("");
        setEditorOpen(true);
    };

    const openEditForm = (item: CreateManagedKey) => {
        setEditingKey(item);
        setForm({
            name: item.name,
            groupId: item.group_id ?? item.group?.id ?? null,
            quota: Number(item.quota || 0) > 0 ? Number(item.quota) : null,
            expiresInDays: null,
            rateLimit5h: Number(item.rate_limit_5h || 0) > 0 ? Number(item.rate_limit_5h) : null,
            rateLimit1d: Number(item.rate_limit_1d || 0) > 0 ? Number(item.rate_limit_1d) : null,
            rateLimit7d: Number(item.rate_limit_7d || 0) > 0 ? Number(item.rate_limit_7d) : null,
        });
        setFormError("");
        setEditorOpen(true);
    };

    const saveKey = async () => {
        if (!session) return;
        const name = form.name.trim();
        if (!name) {
            setFormError("请输入密钥名称");
            return;
        }
        if (form.groupId == null) {
            setFormError("请选择模型分组");
            return;
        }
        setSaving(true);
        setFormError("");
        try {
            if (editingKey) {
                await updateCreateManagedKey(session, editingKey.id, {
                    name,
                    groupId: form.groupId,
                    quota: Number(form.quota || 0),
                    rateLimit5h: Number(form.rateLimit5h || 0),
                    rateLimit1d: Number(form.rateLimit1d || 0),
                    rateLimit7d: Number(form.rateLimit7d || 0),
                });
                message.success("API 密钥已更新");
            } else {
                await createCreateManagedKey(session, name, form.groupId, {
                    quota: Number(form.quota || 0),
                    expiresInDays: Number(form.expiresInDays || 0),
                    rateLimit5h: Number(form.rateLimit5h || 0),
                    rateLimit1d: Number(form.rateLimit1d || 0),
                    rateLimit7d: Number(form.rateLimit7d || 0),
                });
                message.success("API 密钥已创建");
            }
            setEditorOpen(false);
            await onRefresh();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "保存密钥失败");
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = (item: CreateManagedKey) => {
        modal.confirm({
            title: "删除 API 密钥",
            content: `删除「${item.name}」后无法恢复，确定继续吗？`,
            okText: "确认删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                if (!session) return;
                try {
                    await deleteCreateManagedKey(session, item.id);
                    message.success("API 密钥已删除");
                    await onRefresh();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除密钥失败");
                    throw error;
                }
            },
        });
    };

    return (
        <>
            <Modal open={open} onCancel={onClose} footer={null} width={1120} title={<span className="text-2xl font-semibold tracking-tight">API 密钥</span>} styles={{ body: { padding: 20 } }}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                    <p className="text-base text-stone-500 dark:text-stone-400">创建、切换分组、修改限额、复制和删除都在这里完成。</p>
                    <Button
                        type="primary"
                        size="large"
                        className="!border-orange-400 !bg-orange-400 !text-white hover:!border-orange-500 hover:!bg-orange-500"
                        icon={<Plus className="size-4" />}
                        disabled={!session || groupsLoading}
                        onClick={openCreateForm}
                    >
                        创建密钥
                    </Button>
                </div>

                <div className="thin-scrollbar max-h-[68vh] space-y-3 overflow-y-auto pr-1">
                    {loading ? (
                        <div className="flex min-h-40 items-center justify-center">
                            <Spin />
                        </div>
                    ) : null}
                    {!loading && !keys.length ? <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">还没有 API 密钥，点击右上角创建。</div> : null}
                    {!loading
                        ? keys.map((item) => (
                              <article key={item.id} className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-700 dark:bg-stone-900/45">
                                  <div className="flex flex-wrap items-start justify-between gap-4">
                                      <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                              <strong className="text-base font-semibold text-stone-900 dark:text-stone-100">{item.name}</strong>
                                              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", statusClass(item.status))}>{statusLabel(item.status)}</span>
                                              {item.group?.name ? <span className="text-sm text-stone-500 dark:text-stone-400">{item.group.name}</span> : null}
                                          </div>
                                          <code className="mt-1 block truncate font-mono text-sm text-stone-500 dark:text-stone-400">{maskKey(item.key)}</code>
                                          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{quotaSummary(item)}</p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                          <Button size="large" icon={copiedId === item.id ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copyKey(item)}>
                                              {copiedId === item.id ? "已复制" : "复制密钥"}
                                          </Button>
                                          <Button size="large" icon={<Pencil className="size-4" />} aria-label={`编辑 ${item.name}`} title="编辑密钥" onClick={() => openEditForm(item)} />
                                          <Button size="large" danger icon={<Trash2 className="size-4" />} aria-label={`删除 ${item.name}`} title="删除密钥" onClick={() => confirmDelete(item)} />
                                      </div>
                                  </div>
                              </article>
                          ))
                        : null}
                </div>
            </Modal>

            <Modal
                open={editorOpen}
                onCancel={() => setEditorOpen(false)}
                title={<span className="text-2xl font-semibold tracking-tight">{editingKey ? "编辑 API 密钥" : "创建 API 密钥"}</span>}
                okText={editingKey ? "保存修改" : "创建密钥"}
                cancelText="取消"
                confirmLoading={saving}
                okButtonProps={{ disabled: !session || groupsLoading || !form.name.trim() || form.groupId == null, className: "!border-orange-400 !bg-orange-400 !text-white hover:!border-orange-500 hover:!bg-orange-500" }}
                onOk={() => void saveKey()}
                width={1120}
                styles={{ body: { padding: 20 } }}
            >
                <div className="space-y-5">
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950 dark:border-amber-900/60 dark:bg-[#382b1d] dark:text-amber-100">
                        <p className="text-base font-semibold">{editingKey ? "正在编辑已有密钥" : "正在创建新密钥"}</p>
                        <p className="mt-1 text-sm opacity-80">{editingKey ? `${editingKey.name} · ${maskKey(editingKey.key)}` : "保存后会生成一把新的 API 密钥。"}</p>
                    </div>
                    {formError ? <Alert type="error" showIcon message={formError} /> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-base font-medium">名称</span>
                            <Input size="large" value={form.name} maxLength={64} placeholder="例如：图片创作" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                        </label>
                        <label className="block">
                            <span className="mb-2 block text-base font-medium">模型分组</span>
                            <Select
                                className="w-full"
                                size="large"
                                value={form.groupId ?? undefined}
                                loading={groupsLoading}
                                placeholder="请选择模型分组"
                                options={groups.map((group) => ({ value: group.id, label: group.name }))}
                                onChange={(value) => setForm((current) => ({ ...current, groupId: value }))}
                            />
                        </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-base font-medium">额度限制</span>
                            <InputNumber size="large" className="w-full" style={{ width: "100%" }} min={0} precision={2} value={form.quota} placeholder="留空则不限制额度" onChange={(value) => setForm((current) => ({ ...current, quota: value }))} />
                            <span className="mt-1 block text-sm text-stone-500 dark:text-stone-400">留空时不限制额度。</span>
                        </label>
                        {!editingKey ? (
                            <label className="block">
                                <span className="mb-2 block text-base font-medium">有效期（天）</span>
                                <InputNumber
                                    size="large"
                                    className="w-full"
                                    style={{ width: "100%" }}
                                    min={1}
                                    precision={0}
                                    value={form.expiresInDays}
                                    placeholder="留空表示永久"
                                    onChange={(value) => setForm((current) => ({ ...current, expiresInDays: value }))}
                                />
                                <span className="mt-1 block text-sm text-stone-500 dark:text-stone-400">创建后仍可到完整密钥页调整到期时间。</span>
                            </label>
                        ) : null}
                    </div>
                    <div>
                        <p className="text-base font-medium text-stone-700 dark:text-stone-300">调用限额（人民币）</p>
                        <div className="mt-3 grid gap-4 sm:grid-cols-3">
                            <label className="block">
                                <span className="mb-2 block text-base text-stone-700 dark:text-stone-300">每 5 小时</span>
                                <InputNumber size="large" className="w-full" style={{ width: "100%" }} min={0} precision={2} value={form.rateLimit5h} placeholder="不限" onChange={(value) => setForm((current) => ({ ...current, rateLimit5h: value }))} />
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-base text-stone-700 dark:text-stone-300">每 1 天</span>
                                <InputNumber size="large" className="w-full" style={{ width: "100%" }} min={0} precision={2} value={form.rateLimit1d} placeholder="不限" onChange={(value) => setForm((current) => ({ ...current, rateLimit1d: value }))} />
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-base text-stone-700 dark:text-stone-300">每 7 天</span>
                                <InputNumber size="large" className="w-full" style={{ width: "100%" }} min={0} precision={2} value={form.rateLimit7d} placeholder="不限" onChange={(value) => setForm((current) => ({ ...current, rateLimit7d: value }))} />
                            </label>
                        </div>
                    </div>
                </div>
            </Modal>
        </>
    );
}

function nextKeyName(keys: CreateManagedKey[]) {
    const names = new Set(keys.map((item) => item.name));
    if (!names.has("创作密钥")) return "创作密钥";
    let index = 2;
    while (names.has(`创作密钥 ${index}`)) index += 1;
    return `创作密钥 ${index}`;
}

function statusLabel(status: string) {
    return ({ active: "可用", inactive: "已禁用", quota_exhausted: "额度用尽", expired: "已过期" } as Record<string, string>)[status] || status;
}

function statusClass(status: string) {
    if (status === "active") return "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300";
    if (status === "quota_exhausted") return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
    return "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300";
}

function maskKey(value: string) {
    return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function quotaSummary(item: CreateManagedKey) {
    const quota = Number(item.quota || 0);
    const used = Number(item.quota_used || 0);
    const total = quota > 0 ? `额度限制 ￥${quota.toFixed(2)}，已用 ￥${used.toFixed(2)}` : "额度限制不限";
    const limits = [
        Number(item.rate_limit_5h || 0) > 0 ? `5h ￥${Number(item.rate_limit_5h).toFixed(2)}` : "",
        Number(item.rate_limit_1d || 0) > 0 ? `1d ￥${Number(item.rate_limit_1d).toFixed(2)}` : "",
        Number(item.rate_limit_7d || 0) > 0 ? `7d ￥${Number(item.rate_limit_7d).toFixed(2)}` : "",
    ].filter(Boolean);
    return limits.length ? `${total} · ${limits.join(" / ")}` : total;
}
