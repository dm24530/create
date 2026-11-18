import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constant/env";
import {
    desktopUpdateMetadataUrl,
    getDesktopUpdateBridge,
    type DesktopUpdateState,
} from "@/lib/desktop-update";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
    const promptedVersionRef = useRef("");

    const applyState = useCallback((next: DesktopUpdateState, prompt = true) => {
        setState(next);
        if (
            prompt &&
            (next.status === "available" || next.status === "downloaded") &&
            next.latestVersion &&
            promptedVersionRef.current !== next.latestVersion
        ) {
            promptedVersionRef.current = next.latestVersion;
            setOpen(true);
        }
    }, []);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
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
    }, [bridge, t]);

    const installUpdate = useCallback(async () => {
        if (!bridge) throw new Error(t("version.desktopOnly"));
        return bridge.installUpdate();
    }, [bridge, t]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        if (state.status === "idle" || state.status === "error" || state.status === "current") {
            void checkLatestRelease();
        }
    }, [checkLatestRelease, state.status]);

    useEffect(() => {
        if (!bridge) return;
        let disposed = false;
        void bridge.getUpdateState().then((current) => {
            if (!disposed && current) applyState(current);
        });
        const unsubscribe = bridge.onUpdateEvent((next) => {
            if (!disposed) applyState(next);
        });
        void checkLatestRelease();
        const timer = window.setInterval(() => void checkLatestRelease(), CHECK_INTERVAL_MS);
        return () => {
            disposed = true;
            unsubscribe();
            window.clearInterval(timer);
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
        checkLatestRelease,
        downloadUpdate,
        installUpdate,
    };
}
