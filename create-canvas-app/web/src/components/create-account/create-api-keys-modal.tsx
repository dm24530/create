import { Alert, App, Button, Input, Modal, Select, Tag } from "antd";
import { Check, Copy, ImageIcon, KeyRound, Plus, RefreshCw, Video } from "lucide-react";
import { useState } from "react";

import type { CreateSession } from "@/services/create-auth";
import {
    createCreateManagedKey,
    getManagedKeySelection,
    listCreateManagedGroups,
    managedKeySupportsImage,
    managedKeySupportsVideo,
    switchManagedKey,
    type CreateManagedGroup,
    type CreateManagedKey,
    type ManagedKeyRole,
} from "@/services/create-managed-channel";

export function CreateApiKeysModal({ open, onClose, session, keys, loading, onRefresh }: { open: boolean; onClose: () => void; session: CreateSession | null; keys: CreateManagedKey[]; loading: boolean; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const [switching, setSwitching] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [selection, setSelection] = useState(getManagedKeySelection);
    const [applyOpen, setApplyOpen] = useState(false);
    const [groups, setGroups] = useState<CreateManagedGroup[]>([]);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [keyName, setKeyName] = useState("创作密钥");
    const [applying, setApplying] = useState(false);
    const [applyError, setApplyError] = useState("");

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

    const openApply = async () => {
        if (!session) return;
        setApplyOpen(true);
        setApplyError("");
        setGroupsLoading(true);
        setKeyName(nextKeyName(keys));
        try {
            const available = (await listCreateManagedGroups(session)).filter((group) => managedKeySupportsImage(group) || managedKeySupportsVideo(group));
            setGroups(available);
            const preferred = available.find((group) => group.platform === "composite") || available.find((group) => managedKeySupportsImage(group)) || available[0];
            setSelectedGroupId(preferred?.id ?? null);
            if (!available.length) setApplyError("当前账号没有可用的创作分组，请联系管理员。");
        } catch (error) {
            setGroups([]);
            setSelectedGroupId(null);
            setApplyError(error instanceof Error ? error.message : "加载可用分组失败");
        } finally {
            setGroupsLoading(false);
        }
    };

    const applyKey = async () => {
        if (!session || selectedGroupId == null) return;
        const name = keyName.trim();
        if (!name) {
            setApplyError("请输入密钥名称");
            return;
        }
        const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;
        setApplying(true);
        setApplyError("");
        try {
            const created = await createCreateManagedKey(session, name, selectedGroupId);
            const createdWithGroup = { ...created, group: created.group || selectedGroup };
            message.success("API 密钥已申请");
            setApplyOpen(false);
            await onRefresh();
            if (managedKeySupportsImage(createdWithGroup.group)) {
                await switchManagedKey(session, createdWithGroup, "image");
            }
            if (managedKeySupportsVideo(createdWithGroup.group)) {
                await switchManagedKey(session, createdWithGroup, "video");
            }
            setSelection(getManagedKeySelection());
            await onRefresh();
        } catch (error) {
            setApplyError(error instanceof Error ? error.message : "申请密钥失败");
        } finally {
            setApplying(false);
        }
    };

    const selectKey = async (item: CreateManagedKey, role: ManagedKeyRole) => {
        if (!session || item.status !== "active" || switching) return;
        const switchId = `${item.id}:${role}`;
        setSwitching(switchId);
        try {
            await switchManagedKey(session, item, role);
            setSelection(getManagedKeySelection());
            message.success(`${role === "image" ? "生图" : "生视频"}已切换到 ${item.name}`);
            await onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "切换密钥失败");
        } finally {
            setSwitching(null);
        }
    };

    return (
        <>
            <Modal open={open} onCancel={onClose} footer={null} width={820} title="API 密钥">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm text-stone-500">密钥绑定当前登录用户，可按云端分组申请。生图和生视频可以使用不同的 Key。</p>
                    <div className="flex shrink-0 gap-2">
                        <Button type="primary" icon={<Plus className="size-4" />} disabled={!session} onClick={() => void openApply()}>
                            申请密钥
                        </Button>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void onRefresh()}>
                            刷新
                        </Button>
                    </div>
                </div>
                <div className="max-h-[64vh] space-y-3 overflow-y-auto pr-1">
                    {!loading && !keys.length ? (
                        <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
                            <div>还没有 API 密钥</div>
                            <Button className="mt-3" type="primary" icon={<Plus className="size-4" />} onClick={() => void openApply()}>
                                申请密钥
                            </Button>
                        </div>
                    ) : null}
                    {keys.map((item) => {
                        const imageSelected = selection.imageKeyId === item.id;
                        const videoSelected = selection.videoKeyId === item.id;
                        const selected = imageSelected || videoSelected;
                        const imageCapable = managedKeySupportsImage(item.group);
                        const videoCapable = managedKeySupportsVideo(item.group);
                        const active = item.status === "active";
                        return (
                            <article key={item.id} className={`rounded-xl border p-4 ${selected ? "border-orange-400 bg-orange-50/70 dark:border-orange-500/50 dark:bg-orange-950/20" : "border-stone-200 dark:border-stone-800"}`}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <KeyRound className="size-4 text-orange-500" />
                                            <strong className="text-sm">{item.name}</strong>
                                            <Tag color={active ? "green" : "default"}>{statusLabel(item.status)}</Tag>
                                            {imageSelected ? <Tag color="blue">当前生图</Tag> : null}
                                            {videoSelected ? <Tag color="purple">当前生视频</Tag> : null}
                                        </div>
                                        <div className="mt-1 font-mono text-xs text-stone-500">{maskKey(item.key)}</div>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {item.group?.name ? <Tag>{item.group.name}</Tag> : null}
                                            {imageCapable ? <Tag color="blue">生图能力</Tag> : null}
                                            {videoCapable ? <Tag color="purple">生视频能力</Tag> : null}
                                        </div>
                                        <p className="mt-2 text-xs text-stone-500">{quotaSummary(item)}</p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                        <Button icon={copiedId === item.id ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copyKey(item)}>
                                            {copiedId === item.id ? "已复制" : "复制"}
                                        </Button>
                                        {imageCapable ? (
                                            <Button
                                                type={imageSelected ? "primary" : "default"}
                                                icon={<ImageIcon className="size-4" />}
                                                disabled={!active || !session}
                                                loading={switching === `${item.id}:image`}
                                                onClick={() => void selectKey(item, "image")}
                                            >
                                                {imageSelected ? "生图已选" : "用于生图"}
                                            </Button>
                                        ) : null}
                                        {videoCapable ? (
                                            <Button type={videoSelected ? "primary" : "default"} icon={<Video className="size-4" />} disabled={!active || !session} loading={switching === `${item.id}:video`} onClick={() => void selectKey(item, "video")}>
                                                {videoSelected ? "视频已选" : "用于视频"}
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </Modal>
            <Modal
                open={applyOpen}
                title="申请 API 密钥"
                okText="申请密钥"
                cancelText="取消"
                confirmLoading={applying}
                okButtonProps={{ disabled: !session || groupsLoading || selectedGroupId == null || !keyName.trim() }}
                onOk={() => void applyKey()}
                onCancel={() => setApplyOpen(false)}
            >
                <div className="space-y-4 py-2">
                    <p className="text-sm text-stone-500">新密钥会绑定当前登录账号，并按所选云端分组计算额度和权限。</p>
                    {applyError ? <Alert type="error" showIcon message={applyError} /> : null}
                    <label className="block">
                        <span className="mb-1.5 block text-sm font-medium">模型分组</span>
                        <Select
                            className="w-full"
                            value={selectedGroupId ?? undefined}
                            loading={groupsLoading}
                            placeholder={groupsLoading ? "正在加载分组..." : "请选择模型分组"}
                            options={groups.map((group) => ({ value: group.id, label: `${group.name} · ${groupCapabilityLabel(group)}` }))}
                            onChange={(value) => setSelectedGroupId(value)}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1.5 block text-sm font-medium">密钥名称</span>
                        <Input value={keyName} maxLength={64} placeholder="例如：创作密钥" onChange={(event) => setKeyName(event.target.value)} />
                    </label>
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

function groupCapabilityLabel(group: CreateManagedGroup) {
    const capabilities = [managedKeySupportsImage(group) ? "生图" : "", managedKeySupportsVideo(group) ? "生视频" : ""].filter(Boolean);
    return capabilities.length ? capabilities.join(" / ") : "其他能力";
}

function statusLabel(status: string) {
    return ({ active: "可用", inactive: "已禁用", quota_exhausted: "额度用尽", expired: "已过期" } as Record<string, string>)[status] || status;
}

function maskKey(value: string) {
    return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function quotaSummary(item: CreateManagedKey) {
    const quota = Number(item.quota || 0);
    const used = Number(item.quota_used || 0);
    return quota > 0 ? `额度 $${used.toFixed(2)} / $${quota.toFixed(2)}` : "额度不限";
}
