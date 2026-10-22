import { fetchImageModels } from "@/services/api/image";
import {
    guessCapability,
    modelOptionsFromChannels,
    selectableModelsByCapability,
    useConfigStore,
    type ModelChannel,
} from "@/stores/use-config-store";
import { setManagedMode } from "@/lib/managed-mode";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";

function normalizeManagedBaseUrl(raw: string) {
    return new URL(raw, window.location.origin).toString().replace(/\/+$/, "");
}

type ManagedBootstrapPayload = {
    type: "create-canvas-bootstrap";
    baseUrl?: string;
    apiKey?: string;
    managed?: boolean;
    theme?: ThemeName;
};

type ManagedThemePayload = {
    type: "create-canvas-theme";
    theme?: ThemeName;
};

function applyManagedTheme(theme?: ThemeName) {
    if (theme === "light" || theme === "dark") {
        useThemeStore.getState().setTheme(theme);
    }
}

async function applyManagedBootstrap(payload: ManagedBootstrapPayload) {
    applyManagedTheme(payload.theme);
    const baseUrl = payload.baseUrl?.trim() || "";
    const apiKey = payload.apiKey?.trim() || "";
    if (payload.managed) setManagedMode(true);
    if (!baseUrl && !apiKey) return null;
    const normalizedBaseUrl = normalizeManagedBaseUrl(baseUrl || "");
    const result = useConfigStore.getState().importChannelCredentials({
        baseUrl: normalizedBaseUrl,
        apiKey,
    });
    if (result.status !== "created" && result.status !== "updated") return result;

    const state = useConfigStore.getState();
    const matchingIndex = state.config.channels.findIndex((channel) => (
        channel.baseUrl.replace(/\/+$/, "") === normalizedBaseUrl.replace(/\/+$/, "")
    ));
    if (matchingIndex < 0) return result;

    let models: ModelChannel["models"] = [];
    try {
        const names = await fetchImageModels({
            baseUrl: normalizedBaseUrl,
            apiKey: apiKey || "",
            apiFormat: "openai",
        });
        models = names.map((name) => ({
            name,
            capability: guessCapability(name),
        }));
    } catch {
        // Keep the managed channel empty rather than showing stale third-party models.
    }

    const managedChannel = state.config.channels[matchingIndex];
    if (!managedChannel) return result;
    const channels: ModelChannel[] = [{
        ...managedChannel,
        name: "平台 API",
        models,
    }];
    const nextConfig = {
        ...state.config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: managedChannel.baseUrl,
        apiKey: managedChannel.apiKey,
        apiFormat: managedChannel.apiFormat,
    };
    nextConfig.imageModel = selectableModelsByCapability(nextConfig, "image")[0] || nextConfig.imageModel;
    nextConfig.videoModel = selectableModelsByCapability(nextConfig, "video")[0] || nextConfig.videoModel;
    nextConfig.textModel = selectableModelsByCapability(nextConfig, "text")[0] || nextConfig.textModel;
    nextConfig.audioModel = selectableModelsByCapability(nextConfig, "audio")[0] || nextConfig.audioModel;
    nextConfig.model = nextConfig.imageModel;
    useConfigStore.setState({ config: nextConfig, isConfigOpen: false });
    return result;
}

export function listenManagedThemeFromParent() {
    window.addEventListener("message", (event: MessageEvent<ManagedThemePayload>) => {
        if (event.source !== window.parent) return;
        if (event.data?.type !== "create-canvas-theme") return;
        applyManagedTheme(event.data.theme);
    });
}

export function bootstrapManagedConfigFromParent() {
    return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.removeEventListener("message", handleMessage);
            resolve();
        };
        const handleMessage = (event: MessageEvent<ManagedBootstrapPayload>) => {
            if (event.source !== window.parent) return;
            if (event.data?.type !== "create-canvas-bootstrap") return;
            void applyManagedBootstrap(event.data).finally(finish);
        };
        window.addEventListener("message", handleMessage);
        window.setTimeout(finish, 10_000);
    });
}
