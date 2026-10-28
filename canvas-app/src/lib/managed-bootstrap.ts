import { fetchImageModels } from "@/services/api/image";
import {
    createModelChannel,
    guessCapability,
    modelOptionsFromChannels,
    selectableModelsByCapability,
    useConfigStore,
    type ModelChannel,
} from "@/stores/use-config-store";
import { setManagedMode } from "@/lib/managed-mode";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";
import { configureCanvasCloud } from "@/services/canvas-cloud";

function normalizeManagedBaseUrl(raw: string) {
    return new URL(raw, window.location.origin).toString().replace(/\/+$/, "");
}

type ManagedBootstrapPayload = {
    type: "create-canvas-bootstrap";
    baseUrl?: string;
    apiKey?: string;
    videoApiKey?: string;
    accessToken?: string;
    channelName?: string;
    videoChannelName?: string;
    managed?: boolean;
    theme?: ThemeName;
    locale?: AppLocale;
};

type ManagedThemePayload = {
    type: "create-canvas-theme";
    theme?: ThemeName;
};

type ManagedLocalePayload = {
    type: "create-canvas-locale";
    locale?: AppLocale;
};

type ManagedReadyPayload = {
    type: "create-canvas-ready";
};

function applyManagedTheme(theme?: ThemeName) {
    if (theme === "light" || theme === "dark") {
        useThemeStore.getState().setTheme(theme);
    }
}

function applyManagedLocale(locale?: AppLocale) {
    if (locale === "zh-CN" || locale === "en-US") {
        void changeAppLocale(locale);
    }
}

async function applyManagedBootstrap(payload: ManagedBootstrapPayload) {
    applyManagedTheme(payload.theme);
    applyManagedLocale(payload.locale);
    configureCanvasCloud(payload.accessToken);
    const baseUrl = payload.baseUrl?.trim() || "";
    const apiKey = payload.apiKey?.trim() || "";
    const videoApiKey = payload.videoApiKey?.trim() || "";
    if (payload.managed) setManagedMode(true);
    if (!baseUrl || (!apiKey && !videoApiKey)) return null;
    const normalizedBaseUrl = normalizeManagedBaseUrl(baseUrl || "");

    const loadModels = async (credential: string) => {
        if (!credential) return [] as ModelChannel["models"];
        try {
            const names = await fetchImageModels({
                baseUrl: normalizedBaseUrl,
                apiKey: credential,
                apiFormat: "openai",
            });
            return names.map((name) => ({
                name,
                capability: guessCapability(name),
            }));
        } catch {
            // Keep managed channels empty rather than showing models from another credential.
            return [] as ModelChannel["models"];
        }
    };

    const [imageModels, videoModels] = await Promise.all([
        loadModels(apiKey),
        loadModels(videoApiKey),
    ]);
    const channels: ModelChannel[] = [];
    if (apiKey) {
        channels.push(createModelChannel({
            id: "managed-image",
            name: payload.channelName?.trim() || "平台 API",
            baseUrl: normalizedBaseUrl,
            apiKey,
            apiFormat: "openai",
            models: imageModels.filter((model) => model.capability !== "video"),
        }));
    }
    if (videoApiKey) {
        channels.push(createModelChannel({
            id: "managed-video",
            name: payload.videoChannelName?.trim() || payload.channelName?.trim() || "平台 API",
            baseUrl: normalizedBaseUrl,
            apiKey: videoApiKey,
            apiFormat: "openai",
            models: videoModels.filter((model) => model.capability === "video"),
        }));
    }
    if (!channels.length) return null;

    const state = useConfigStore.getState();
    const primaryChannel = channels[0];
    const nextConfig = {
        ...state.config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: primaryChannel.baseUrl,
        apiKey: primaryChannel.apiKey,
        apiFormat: primaryChannel.apiFormat,
    };
    nextConfig.imageModel = selectableModelsByCapability(nextConfig, "image")[0] || "";
    nextConfig.videoModel = selectableModelsByCapability(nextConfig, "video")[0] || "";
    nextConfig.textModel = selectableModelsByCapability(nextConfig, "text")[0] || "";
    nextConfig.audioModel = selectableModelsByCapability(nextConfig, "audio")[0] || "";
    nextConfig.model = nextConfig.imageModel || nextConfig.videoModel || nextConfig.textModel;
    useConfigStore.setState({ config: nextConfig, isConfigOpen: false });
    return nextConfig;
}

export function listenManagedThemeFromParent() {
    window.addEventListener("message", (event: MessageEvent<ManagedThemePayload>) => {
        if (event.source !== window.parent) return;
        if (event.data?.type !== "create-canvas-theme") return;
        applyManagedTheme(event.data.theme);
    });
}

export function listenManagedLocaleFromParent() {
    window.addEventListener("message", (event: MessageEvent<ManagedLocalePayload>) => {
        if (event.source !== window.parent) return;
        if (event.data?.type !== "create-canvas-locale") return;
        applyManagedLocale(event.data.locale);
    });
}

export function listenManagedCloudSessionFromParent() {
    window.addEventListener("message", (event: MessageEvent<ManagedBootstrapPayload>) => {
        if (event.source !== window.parent) return;
        if (event.data?.type !== "create-canvas-bootstrap") return;
        configureCanvasCloud(event.data.accessToken);
    });
}

export function notifyManagedCanvasReady() {
    if (window.parent === window) return;
    let targetOrigin = "*";
    try {
        if (document.referrer) targetOrigin = new URL(document.referrer).origin;
    } catch {
        // The ready signal contains no credentials and is safe as a wildcard fallback.
    }
    const payload: ManagedReadyPayload = { type: "create-canvas-ready" };
    window.parent.postMessage(payload, targetOrigin);
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
