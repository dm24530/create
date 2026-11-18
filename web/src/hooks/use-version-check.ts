import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constant/env";
import {
    clearSkippedUpdateVersion as clearStoredSkippedUpdateVersion,
    desktopUpdateMetadataUrl,
    getDesktopUpdateBridge,
    normalizeUpdateVersion,
    readSkippedUpdateVersion,
    shouldAutoPromptForUpdate,
    UPDATE_CHECK_THROTTLE_MS,
    writeSkippedUpdateVersion as writeStoredSkippedUpdateVersion,
    type DesktopUpdateState,
} from "@/lib/desktop-update";

const INITIAL_STATE: DesktopUpdateState = {
    status: "idle",
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    notes: "",
    publishedAt: "",
    minimumVersion: "",
    updateBaseUrl: "",
    progress: null,
    error: "",
};

export function useVersionCheck() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const bridge = useMemo(getDesktopUpdateBridge, []);
    const [state, setState] = useState<DesktopUpdateState>(INITIAL_STATE);
    const [open, setOpen] = useState(false);
    const [checking, setChecking] = useState(false);
    const [skippedVersion, setSkippedVersionState] = useState(readSkippedUpdateVersion);
    const promptedVersionRef = useRef("");
    const skippedVersionRef = useRef(skippedVersion);
    const lastCheckAtRef = useRef(0);

    const applyState = useCallback((next: DesktopUpdateState, prompt = true) => {
        setState(next);
        if (
            prompt &&
            shouldAutoPromptForUpdate(
                next,
                skippedVersionRef.current,
                promptedVersionRef.current,
            )
        ) {
            promptedVersionRef.current = normalizeUpdateVersion(next.latestVersion);
            setOpen(true);
        }
    }, []);

    const persistSkippedVersion = useCallback((version: string, persistToDesktop = true) => {
        const normalized = normalizeUpdateVersion(version);
        skippedVersionRef.current = normalized;
        setSkippedVersionState(normalized);
        writeStoredSkippedUpdateVersion(normalized);
        if (persistToDesktop && bridge?.setSkippedUpdateVersion) {
            void bridge.setSkippedUpdateVersion(normalized).catch(() => undefined);
        }
        return normalized;
    }, [bridge]);

    const clearSkippedVersion = useCallback(() => {
        skippedVersionRef.current = "";
        setSkippedVersionState("");
        clearStoredSkippedUpdateVersion();
        if (bridge?.clearSkippedUpdateVersion) {
            void bridge.clearSkippedUpdateVersion().catch(() => undefined);
        }
    }, [bridge]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            lastCheckAtRef.current = Date.now();
            if (!bridge) {
                const unsupported = {
                    ...INITIAL_STATE,
                    status: "unsupported" as const,
                    error: "desktop bridge is unavailable",
                };
                applyState(unsupported, false);
                if (showMessage) message.info(t("version.desktopOnly"));
                return false;
            }
            setChecking(true);
            try {
                const next = await bridge.checkForUpdates(desktopUpdateMetadataUrl());
                applyState(next);
                if (showMessage) {
                    if (next.status === "current") message.success(t("version.alreadyLatest"));
                    else if (next.status === "error") message.error(next.error || t("version.updateFailed"));
                    else message.success(t("version.updated"));
                }
                return next.status === "available" || next.status === "current";
            } catch (error) {
                const nextError = error instanceof Error ? error.message : String(error);
                setState((previous) => ({ ...previous, status: "error", error: nextError }));
                if (showMessage) message.error(nextError || t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [applyState, bridge, message, t],
    );

    const downloadUpdate = useCallback(async () => {
        if (!bridge) throw new Error(t("version.desktopOnly"));
        clearSkippedVersion();
        setState((previous) => ({
            ...previous,
            status: "downloading",
            progress: previous.progress || { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
            error: "",
        }));
        try {
            return await bridge.downloadUpdate();
        } catch (error) {
            const nextError = error instanceof Error ? error.message : String(error);
            setState((previous) => ({ ...previous, status: "error", error: nextError }));
            throw error;
        }
    }, [bridge, clearSkippedVersion, t]);

    const installUpdate = useCallback(async () => {
        if (!bridge) throw new Error(t("version.desktopOnly"));
        return bridge.installUpdate();
    }, [bridge, t]);

    const skipVersion = useCallback((version = state.latestVersion) => {
        persistSkippedVersion(version);
        setOpen(false);
    }, [persistSkippedVersion, state.latestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        if (state.status === "idle" || state.status === "error" || state.status === "current") {
            void checkLatestRelease();
        }
    }, [checkLatestRelease, state.status]);

    useEffect(() => {
        if (!bridge) return;
        let disposed = false;
        let unsubscribe: () => void = () => undefined;

        const loadPreferencesAndCheck = async () => {
            let skipped = readSkippedUpdateVersion();
            try {
                const desktopSkipped = await bridge.getSkippedUpdateVersion?.();
                if (desktopSkipped) {
                    skipped = normalizeUpdateVersion(desktopSkipped);
                    writeStoredSkippedUpdateVersion(skipped);
                } else if (skipped && bridge.setSkippedUpdateVersion) {
                    await bridge.setSkippedUpdateVersion(skipped);
                }
            } catch {
                // Keep the renderer preference if the desktop bridge is temporarily unavailable.
            }
            if (disposed) return;
            skippedVersionRef.current = skipped;
            setSkippedVersionState(skipped);
            unsubscribe = bridge.onUpdateEvent((next) => {
                if (!disposed) applyState(next);
            });

            const current = await bridge.getUpdateState().catch(() => null);
            if (!disposed && current) applyState(current);
            if (!disposed) await checkLatestRelease();
        };

        void loadPreferencesAndCheck();

        const runBackgroundCheck = () => {
            if (Date.now() - lastCheckAtRef.current < UPDATE_CHECK_THROTTLE_MS) return;
            void checkLatestRelease();
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") runBackgroundCheck();
        };

        window.addEventListener("focus", runBackgroundCheck);
        window.addEventListener("online", runBackgroundCheck);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            disposed = true;
            unsubscribe();
            window.removeEventListener("focus", runBackgroundCheck);
            window.removeEventListener("online", runBackgroundCheck);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [applyState, bridge, checkLatestRelease]);

    const hasNewVersion =
        state.status === "available" ||
        state.status === "downloading" ||
        state.status === "downloaded";

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion: state.latestVersion,
        currentVersion: state.currentVersion,
        notes: state.notes,
        publishedAt: state.publishedAt,
        minimumVersion: state.minimumVersion,
        progress: state.progress,
        status: state.status,
        error: state.error,
        checking,
        hasNewVersion,
        skippedVersion,
        checkLatestRelease,
        downloadUpdate,
        installUpdate,
        skipVersion,
        clearSkippedVersion,
    };
}
