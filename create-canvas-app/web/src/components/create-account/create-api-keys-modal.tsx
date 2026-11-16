import { App, Button, Modal, Tag } from "antd";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { CreateSession } from "@/services/create-auth";
import {
    managedKeySupportsImage,
    managedKeySupportsVideo,
    switchManagedKey,
    type CreateManagedKey,
} from "@/services/create-managed-channel";
import { useConfigStore } from "@/stores/use-config-store";

export function CreateApiKeysModal({
    open,
    onClose,
    session,
    keys,
    loading,
    onRefresh,
}: {
    open: boolean;
    onClose: () => void;
    session: CreateSession | null;
    keys: CreateManagedKey[];
    loading: boolean;
    onRefresh: () => Promise<void>;
}) {
    const { message } = App.useApp();
    const [switchingId, setSwitchingId] = useState<number | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const currentApiKey = useConfigStore((state) => state.config.apiKey);

    const copyKey = async (item: CreateManagedKey) => {
        try {
            await navigator.clipboard.writeText(item.key);
            setCopiedId(item.id);
            message.success("API 密钥已复制");
            window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1600);
        } catch {
            message.error("复制密钥失败");
        }
    };

    const selectKey = async (item: CreateManagedKey) => {
        if (!session || item.status !== "active" || switchingId !== null) return;
        setSwitchingId(item.id);
        try {
            await switchManagedKey(session, item);
            message.success(`已切换到 ${item.name}`);
            await onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "切换密钥失败");
        } finally {
            setSwitchingId(null);
        }
    };

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={760} title="API 密钥">
            <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-stone-500">查看当前账号的创作密钥、额度和可用能力。选择“使用”后会立即切换图片、视频和画布的工作台通道。</p>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void onRefresh()}>
                    刷新
                </Button>
            </div>
            <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
                {!loading && !keys.length ? <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">没有可用的 API 密钥</div> : null}
                {keys.map((item) => {
                    const selected = Boolean(currentApiKey && item.key === currentApiKey);
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
                                        {selected ? <Tag color="orange">当前使用</Tag> : null}
                                    </div>
                                    <div className="mt-1 font-mono text-xs text-stone-500">{maskKey(item.key)}</div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {item.group?.name ? <Tag>{item.group.name}</Tag> : null}
                                        {imageCapable ? <Tag color="blue">生图</Tag> : null}
                                        {videoCapable ? <Tag color="purple">生视频</Tag> : null}
                                    </div>
                                    <p className="mt-2 text-xs text-stone-500">{quotaSummary(item)}</p>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <Button icon={copiedId === item.id ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copyKey(item)}>
                                        {copiedId === item.id ? "已复制" : "复制"}
                                    </Button>
                                    <Button type="primary" disabled={!active || !session} loading={switchingId === item.id} onClick={() => void selectKey(item)}>
                                        {selected ? "已选择" : "使用"}
                                    </Button>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </Modal>
    );
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
