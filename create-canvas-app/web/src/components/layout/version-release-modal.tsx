import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Alert, Button, Modal, Progress, Tag } from "antd";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVersionCheck } from "@/hooks/use-version-check";
import { getDesktopUpdateBridge } from "@/lib/desktop-update";

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { t } = useTranslation();
    const bridge = useMemo(getDesktopUpdateBridge, []);
    const {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        currentVersion,
        notes,
        publishedAt,
        progress,
        status,
        error,
        checking,
        hasNewVersion,
        downloadUpdate,
        installUpdate,
    } = useVersionCheck();
    const [actionError, setActionError] = useState("");

    if (!bridge) return null;

    const updateAvailable = status === "available";
    const downloading = status === "downloading";
    const downloaded = status === "downloaded";
    const unavailable = status === "current" || status === "unsupported" || status === "idle";
    const title = updateAvailable || downloading || downloaded
        ? t("version.updateAvailableTitle", { version: latestVersion || currentVersion })
        : t("version.title");

    const beginDownload = async () => {
        setActionError("");
        try {
            await downloadUpdate();
        } catch (nextError) {
            setActionError(nextError instanceof Error ? nextError.message : String(nextError));
        }
    };

    const beginInstall = async () => {
        setActionError("");
        try {
            await installUpdate();
        } catch (nextError) {
            setActionError(nextError instanceof Error ? nextError.message : String(nextError));
        }
    };

    return (
        <>
            <button
                type="button"
                className={className || "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-stone-500 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                title={hasNewVersion ? t("version.newVersionAvailable") : t("version.viewUpdates")}
            >
                <RefreshCw className={checking ? "size-3.5 animate-spin" : "size-3.5"} />
                <span className="tabular-nums">{currentVersion}</span>
                {hasNewVersion ? <span className="absolute right-0 top-0 size-2 rounded-full bg-orange-500 ring-2 ring-background" /> : null}
            </button>

            <Modal
                title={title}
                open={open}
                width={640}
                centered
                onCancel={() => setOpen(false)}
                footer={[
                    unavailable ? (
                        <Button key="close" onClick={() => setOpen(false)}>
                            {t("common.close")}
                        </Button>
                    ) : null,
                    updateAvailable ? (
                        <Button key="later" onClick={() => setOpen(false)}>
                            {t("version.later")}
                        </Button>
                    ) : null,
                    downloaded ? (
                        <Button key="later-install" onClick={() => setOpen(false)}>
                            {t("version.installLater")}
                        </Button>
                    ) : null,
                    updateAvailable ? (
                        <Button key="update" type="primary" icon={<Download className="size-4" />} onClick={() => void beginDownload()}>
                            {t("version.updateNow")}
                        </Button>
                    ) : null,
                    downloaded ? (
                        <Button key="install" type="primary" icon={<RotateCcw className="size-4" />} onClick={() => void beginInstall()}>
                            {t("version.restartAndInstall")}
                        </Button>
                    ) : null,
                    downloading ? (
                        <Button key="background" onClick={() => setOpen(false)}>
                            {t("version.backgroundDownload")}
                        </Button>
                    ) : null,
                    status === "error" || status === "unsupported" ? (
                        <Button key="retry" type="primary" onClick={() => void openReleaseModal()}>
                            {t("version.retry")}
                        </Button>
                    ) : null,
                ].filter(Boolean)}
            >
                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                            <div className="text-xs text-stone-500 dark:text-stone-400">{t("version.currentVersion")}</div>
                            <div className="mt-1 font-mono text-lg font-semibold text-stone-950 dark:text-stone-100">{currentVersion}</div>
                        </div>
                        <div className="rounded-xl border border-orange-200 bg-orange-50/70 p-4 dark:border-orange-900/70 dark:bg-orange-950/20">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-stone-500 dark:text-stone-400">{t("version.latestVersion")}</div>
                                {updateAvailable || downloading || downloaded ? <Tag color="orange">{t("version.new")}</Tag> : null}
                            </div>
                            <div className="mt-1 font-mono text-lg font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                        </div>
                    </div>

                    {publishedAt ? (
                        <div className="text-xs text-stone-500 dark:text-stone-400">
                            {t("version.publishedAt", { date: publishedAt })}
                        </div>
                    ) : null}

                    {updateAvailable || downloading || downloaded ? (
                        <div>
                            <div className="mb-2 text-sm font-semibold text-stone-950 dark:text-stone-100">{t("version.releaseNotes")}</div>
                            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-7 text-stone-700 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300">
                                {notes || t("version.noReleaseNotes")}
                            </div>
                        </div>
                    ) : null}

                    {downloading ? (
                        <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-stone-800 dark:text-stone-200">{t("version.downloading")}</span>
                                <span className="font-mono text-xs text-stone-500">{Math.round(progress?.percent || 0)}%</span>
                            </div>
                            <Progress percent={Math.round(progress?.percent || 0)} showInfo={false} status="active" />
                            <div className="mt-2 flex justify-between text-xs text-stone-500 dark:text-stone-400">
                                <span>{formatBytes(progress?.transferred || 0)} / {formatBytes(progress?.total || 0)}</span>
                                <span>{formatBytes(progress?.bytesPerSecond || 0)}/s</span>
                            </div>
                        </div>
                    ) : null}

                    {downloaded ? (
                        <Alert type="success" showIcon message={t("version.downloadCompleteTitle")} description={t("version.downloadCompleteDescription")} />
                    ) : null}

                    {status === "current" ? <Alert type="success" showIcon message={t("version.alreadyLatest")} /> : null}
                    {status === "unsupported" ? <Alert type="info" showIcon message={t("version.desktopOnly")} /> : null}
                    {status === "error" || actionError || error ? (
                        <Alert type="error" showIcon message={t("version.downloadFailed")} description={actionError || error || t("version.updateFailed")} />
                    ) : null}
                </div>
            </Modal>
        </>
    );
}
