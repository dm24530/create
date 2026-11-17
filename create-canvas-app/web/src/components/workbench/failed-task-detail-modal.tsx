import { App, Button, Modal, Typography } from "antd";
import { Copy, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { generationFailureReason } from "@/lib/generation-error";

export type FailedTaskDetail = {
    id: string;
    logId?: string;
    prompt?: string;
    error?: string;
    model?: string;
    referenceCount?: number;
};

export function FailedTaskDetailModal({
    detail,
    onClose,
    onDelete,
}: {
    detail: FailedTaskDetail | null;
    onClose: () => void;
    onDelete: (detail: FailedTaskDetail) => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const prompt = detail?.prompt?.trim() || "";
    const failureReason = generationFailureReason(detail?.error, t("workbench.failureReasonUnavailable"));

    const copyPrompt = async () => {
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("common.promptCopied"));
        } catch {
            message.error(t("apiErrors.requestFailed"));
        }
    };

    return (
        <Modal
            centered
            open={Boolean(detail)}
            title="失败任务详情"
            onCancel={onClose}
            footer={[
                <Button
                    key="delete"
                    danger
                    icon={<Trash2 className="size-3.5" />}
                    onClick={() => detail && onDelete(detail)}
                >
                    {t("common.delete")}
                </Button>,
                <Button
                    key="copy"
                    icon={<Copy className="size-3.5" />}
                    disabled={!prompt}
                    onClick={() => void copyPrompt()}
                >
                    {t("common.copyPrompt")}
                </Button>,
                <Button key="close" type="primary" onClick={onClose}>
                    {t("common.done")}
                </Button>,
            ]}
        >
            <div className="space-y-4">
                <div>
                    <div className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">提示词</div>
                    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap break-words rounded-lg border border-stone-200 bg-stone-50 p-3 !text-sm !leading-6 dark:border-stone-700 dark:bg-stone-900 dark:!text-stone-100">
                        {prompt || "无提示词"}
                    </Typography.Paragraph>
                </div>
                <div>
                    <div className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">失败原因</div>
                    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-red-50 p-3 !text-sm !leading-6 !text-red-600 dark:border-red-950 dark:bg-red-950/20 dark:!text-red-300">
                        {failureReason}
                    </Typography.Paragraph>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    {detail?.model ? <span>模型：{detail.model}</span> : null}
                    {detail?.referenceCount ? <span>参考素材：{detail.referenceCount}</span> : null}
                </div>
            </div>
        </Modal>
    );
}
