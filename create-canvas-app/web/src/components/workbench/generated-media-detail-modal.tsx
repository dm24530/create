import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { Copy, Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatBytes, formatDuration } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";

export type GeneratedMediaDetailData = {
    kind: "image" | "video";
    src: string;
    prompt?: string;
    model?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
};

type GeneratedMediaDetailModalProps = {
    data: GeneratedMediaDetailData | null;
    onClose: () => void;
    onDownload?: (data: GeneratedMediaDetailData) => void | Promise<void>;
};

export function GeneratedMediaDetailModal({ data, onClose, onDownload }: GeneratedMediaDetailModalProps) {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const prompt = data?.prompt?.trim() || "";
    const hasDimensions = Boolean(data?.width && data?.height);

    useEffect(() => {
        if (!data) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [data, onClose]);

    if (!data || typeof document === "undefined") return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-label={t("workbench.details")}
                className="max-h-[92vh] w-full max-w-[1080px] overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-950"
            >
                <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-stone-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
                    <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">{t("workbench.details")}</h2>
                    <button
                        type="button"
                        className="flex size-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        aria-label={t("common.cancel")}
                        onClick={onClose}
                    >
                        <X className="size-5" />
                    </button>
                </header>

                <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
                    <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl bg-stone-950">
                        {data.kind === "image" ? (
                            <img src={data.src} alt={t("workbench.details")} className="max-h-[70vh] w-full object-contain" />
                        ) : (
                            <video src={data.src} controls className="max-h-[70vh] w-full bg-black object-contain" />
                        )}
                    </div>

                    <section className="flex min-w-0 flex-col gap-4">
                        <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t("workbench.prompt")}</h3>
                                <Button size="small" icon={<Copy className="size-3.5" />} disabled={!prompt} onClick={() => copyText(prompt, t("common.promptCopied"))}>
                                    {t("common.copy")}
                                </Button>
                            </div>
                            <div className="max-h-56 min-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-6 text-stone-700 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300">
                                {prompt || t("workbench.noPrompt")}
                            </div>
                        </div>

                        <dl className="grid grid-cols-2 gap-3 text-sm">
                            {data.model ? (
                                <div className="col-span-2 min-w-0">
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.model")}</dt>
                                    <dd className="mt-1 truncate font-medium text-stone-900 dark:text-stone-100">{data.model}</dd>
                                </div>
                            ) : null}
                            {hasDimensions ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.dimensions")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{data.width}x{data.height}</dd>
                                </div>
                            ) : null}
                            {data.bytes ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.fileSize")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatBytes(data.bytes)}</dd>
                                </div>
                            ) : null}
                            {data.durationMs ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.generationDuration")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(data.durationMs)}</dd>
                                </div>
                            ) : null}
                        </dl>

                        {onDownload ? (
                            <Button className="mt-auto" block icon={<Download className="size-4" />} onClick={() => void onDownload(data)}>
                                {t("common.download")}
                            </Button>
                        ) : null}
                    </section>
                </div>
            </section>
        </div>,
        document.body,
    );
}