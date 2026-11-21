import { fetchImageModels } from "@/services/api/image";
import { createRequest } from "@/services/create-api";
import type { CreateSession } from "@/services/create-auth";
import { createGatewayBaseUrl } from "@/lib/create-product";
import { configureCanvasCloud } from "@/services/canvas-cloud";
import { createModelChannel, guessCapability, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import type { VideoCapabilityProfile } from "@/lib/video-model-profile";

export type CreateManagedGroup = {
    id: number;
    name: string;
    platform?: string;
    allow_image_generation?: boolean;
    video_capable?: boolean;
    video_price_480p?: number | null;
    video_price_720p?: number | null;
    video_price_1080p?: number | null;
};

export type CreateManagedKey = {
    id: number;
    key: string;
    name: string;
    status: string;
    group_id?: number | null;
    group?: CreateManagedGroup | null;
    quota?: number;
    quota_used?: number;
    rate_limit_5h?: number;
    rate_limit_1d?: number;
    rate_limit_7d?: number;
    usage_5h?: number;
    usage_1d?: number;
    usage_7d?: number;
    expires_at?: string | null;
    created_at?: string;
    last_used_at?: string | null;
};

export type CreateManagedKeyOptions = {
    quota?: number;
    expiresInDays?: number;
    rateLimit5h?: number;
    rateLimit1d?: number;
    rateLimit7d?: number;
};

export type UpdateCreateManagedKeyInput = {
    name: string;
    groupId: number;
    quota: number;
    rateLimit5h: number;
    rateLimit1d: number;
    rateLimit7d: number;
};

const SELECTED_IMAGE_KEY_STORAGE = "create-canvas:selected-image-key-id";
const SELECTED_VIDEO_KEY_STORAGE = "create-canvas:selected-video-key-id";
const WORKSPACE_REQUEST_TIMEOUT_MS = 15_000;
const WORKSPACE_CONFIGURATION_CACHE_MS = 30_000;

type KeysPage = { items?: CreateManagedKey[] };

type WorkspaceDependencies = {
    listKeys: (session: CreateSession) => Promise<CreateManagedKey[]>;
    listGroups: (session: CreateSession) => Promise<CreateManagedGroup[]>;
    createKey: (session: CreateSession, name: string, groupId: number) => Promise<CreateManagedKey>;
    loadModels: (apiKey: string) => Promise<string[]>;
    loadVideoCapabilities?: (session: CreateSession, groupId: number) => Promise<Record<string, VideoCapabilityProfile>>;
};

type CreateWorkspaceConfiguration = {
    imageKey: CreateManagedKey;
    videoKey: CreateManagedKey | null;
    imageModels: string[];
    videoModels: string[];
    videoCapabilities: Record<string, VideoCapabilityProfile>;
    imageChannelModels: number;
};

let workspaceConfigurationCache: { accessToken: string; createdAt: number; promise: Promise<CreateWorkspaceConfiguration> } | null = null;

export type ManagedKeyRole = "image" | "video";

export function managedKeySupportsImage(group?: CreateManagedGroup | null) {
    return group?.allow_image_generation === true;
}

export function managedKeySupportsVideo(group?: CreateManagedGroup | null) {
    if (!group) return false;
    return Boolean(group.video_capable || group.platform === "composite" || group.video_price_480p != null || group.video_price_720p != null || group.video_price_1080p != null);
}

export function getManagedKeySelection() {
    return { imageKeyId: storedSelectedKeyId("image"), videoKeyId: storedSelectedKeyId("video") };
}

function storedSelectedKeyId(role: ManagedKeyRole) {
    try {
        const key = role === "image" ? SELECTED_IMAGE_KEY_STORAGE : SELECTED_VIDEO_KEY_STORAGE;
        return Number(localStorage.getItem(key) || 0);
    } catch {
        return 0;
    }
}

function rememberSelectedKey(role: ManagedKeyRole, id: number | null | undefined) {
    try {
        const key = role === "image" ? SELECTED_IMAGE_KEY_STORAGE : SELECTED_VIDEO_KEY_STORAGE;
        if (id && id > 0) localStorage.setItem(key, String(id));
        else localStorage.removeItem(key);
    } catch {
        // Local persistence is best-effort in hardened browser contexts.
    }
}

function isActiveKey(key: CreateManagedKey) {
    return key.status === "active" && Boolean(key.key?.trim());
}

function chooseCompositeKey(keys: CreateManagedKey[]) {
    return keys.find((key) => key.group?.platform === "composite" && managedKeySupportsImage(key.group) && managedKeySupportsVideo(key.group));
}

function chooseCapableKey(keys: CreateManagedKey[], supports: (group?: CreateManagedGroup | null) => boolean) {
    return keys.find((key) => supports(key.group));
}

function chooseGroup(groups: CreateManagedGroup[], supports: (group?: CreateManagedGroup | null) => boolean) {
    return groups.filter((group) => supports(group)).sort((left, right) => Number(right.platform === "composite") - Number(left.platform === "composite"))[0] || null;
}

function modelsFor(channel: ModelChannel, capability: ModelCapability) {
    return channel.models.filter((model) => model.capability === capability);
}

function channelFromModels(
    id: string,
    name: string,
    apiKey: string,
    models: string[],
    capabilities?: ModelCapability[],
    videoCapabilities: Record<string, VideoCapabilityProfile> = {},
) {
    const allowed = capabilities ? new Set(capabilities) : null;
    return createModelChannel({
        id,
        name,
        baseUrl: createGatewayBaseUrl(),
        apiKey,
        apiFormat: "openai",
        models: models.map((model) => {
            const name = model.trim();
            const videoCapability = videoCapabilities[name.toLowerCase()];
            return {
                name,
                capability: videoCapability ? "video" as const : guessCapability(name),
                videoCapabilities: videoCapability,
            };
        }).filter((model) => !allowed || allowed.has(model.capability)),
    });
}

function applyManagedChannels(channels: ModelChannel[]) {
    if (!channels.length) return;
    const state = useConfigStore.getState();
    const primary = channels[0];
    const nextConfig = {
        ...state.config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: primary.baseUrl,
        apiKey: primary.apiKey,
        apiFormat: primary.apiFormat,
    };
    const preserveOrFirst = (current: string, capability: ModelCapability) => {
        const options = selectableModelsByCapability(nextConfig, capability);
        const normalized = normalizeModelOptionValue(current, channels);
        return options.includes(normalized) ? normalized : options[0] || "";
    };
    nextConfig.imageModel = preserveOrFirst(state.config.imageModel, "image");
    nextConfig.videoModel = preserveOrFirst(state.config.videoModel, "video");
    nextConfig.textModel = preserveOrFirst(state.config.textModel, "text");
    nextConfig.audioModel = preserveOrFirst(state.config.audioModel, "audio");
    nextConfig.model = nextConfig.imageModel || nextConfig.videoModel || nextConfig.textModel;
    useConfigStore.setState({ config: nextConfig, isConfigOpen: false });
}

function defaultDependencies(overrides: Partial<WorkspaceDependencies> = {}): WorkspaceDependencies {
    return {
        listKeys: listCreateManagedKeys,
        listGroups: listCreateManagedGroups,
        createKey: createCreateManagedKey,
        loadModels: (apiKey) =>
            fetchImageModels({
                baseUrl: createGatewayBaseUrl(),
                apiKey,
                apiFormat: "openai",
            }),
        loadVideoCapabilities: overrides.loadModels ? async () => ({}) : loadCreateVideoCapabilities,
        ...overrides,
    };
}

type CreateAvailableModel = {
    name?: string;
    video_capabilities?: VideoCapabilityProfile | null;
};

type CreateAvailableSection = {
    groups?: Array<{ id?: number }>;
    supported_models?: CreateAvailableModel[];
};

type CreateAvailableChannel = {
    platforms?: CreateAvailableSection[];
};

export async function loadCreateVideoCapabilities(session: CreateSession, groupId: number): Promise<Record<string, VideoCapabilityProfile>> {
    if (!session?.accessToken || !Number(groupId)) return {};
    const channels = await createRequest<CreateAvailableChannel[]>("/models/available", {
        accessToken: session.accessToken,
        timeoutMs: WORKSPACE_REQUEST_TIMEOUT_MS,
    });
    const capabilities: Record<string, VideoCapabilityProfile> = {};
    for (const channel of channels || []) {
        for (const section of channel.platforms || []) {
            if (!(section.groups || []).some((group) => Number(group.id) === Number(groupId))) continue;
            for (const model of section.supported_models || []) {
                const name = String(model.name || "").trim().toLowerCase();
                if (!name || !model.video_capabilities || capabilities[name]) continue;
                capabilities[name] = model.video_capabilities;
            }
        }
    }
    return capabilities;
}

export async function listCreateManagedKeys(session: CreateSession): Promise<CreateManagedKey[]> {
    const page = await createRequest<KeysPage>("/keys?page=1&page_size=100", {
        accessToken: session.accessToken,
        timeoutMs: WORKSPACE_REQUEST_TIMEOUT_MS,
    });
    return page.items || [];
}

export async function listCreateManagedGroups(session: CreateSession): Promise<CreateManagedGroup[]> {
    return createRequest<CreateManagedGroup[]>("/groups/available", {
        accessToken: session.accessToken,
        timeoutMs: WORKSPACE_REQUEST_TIMEOUT_MS,
    });
}

export async function createCreateManagedKey(session: CreateSession, name: string, groupId: number, options: CreateManagedKeyOptions = {}): Promise<CreateManagedKey> {
    const payload: Record<string, string | number> = { name, group_id: groupId };
    if (Number(options.quota || 0) > 0) payload.quota = Number(options.quota);
    if (Number(options.expiresInDays || 0) > 0) payload.expires_in_days = Number(options.expiresInDays);
    if (Number(options.rateLimit5h || 0) > 0) payload.rate_limit_5h = Number(options.rateLimit5h);
    if (Number(options.rateLimit1d || 0) > 0) payload.rate_limit_1d = Number(options.rateLimit1d);
    if (Number(options.rateLimit7d || 0) > 0) payload.rate_limit_7d = Number(options.rateLimit7d);
    return createRequest<CreateManagedKey>("/keys", {
        method: "POST",
        accessToken: session.accessToken,
        body: JSON.stringify(payload),
        timeoutMs: WORKSPACE_REQUEST_TIMEOUT_MS,
    });
}

export async function updateCreateManagedKey(session: CreateSession, id: number, input: UpdateCreateManagedKeyInput): Promise<CreateManagedKey> {
    return createRequest<CreateManagedKey>(`/keys/${id}`, {
        method: "PUT",
        accessToken: session.accessToken,
        body: JSON.stringify({
            name: input.name,
            group_id: input.groupId,
            quota: Math.max(0, Number(input.quota || 0)),
            rate_limit_5h: Math.max(0, Number(input.rateLimit5h || 0)),
            rate_limit_1d: Math.max(0, Number(input.rateLimit1d || 0)),
            rate_limit_7d: Math.max(0, Number(input.rateLimit7d || 0)),
        }),
        timeoutMs: WORKSPACE_REQUEST_TIMEOUT_MS,
    });
}

export async function deleteCreateManagedKey(session: CreateSession, id: number): Promise<void> {
    await createRequest(`/keys/${id}`, {
        method: "DELETE",
        accessToken: session.accessToken,
        timeoutMs: WORKSPACE_REQUEST_TIMEOUT_MS,
    });
}

export async function resolveManagedCredentials(session: CreateSession, deps: WorkspaceDependencies): Promise<{ imageKey: CreateManagedKey; videoKey: CreateManagedKey | null; groups: CreateManagedGroup[] }> {
    const [initialKeys, groups] = await Promise.all([deps.listKeys(session), deps.listGroups(session)]);
    const activeKeys = initialKeys.filter(isActiveKey);
    const composite = chooseCompositeKey(activeKeys);
    const selectedImage = activeKeys.find((key) => key.id === storedSelectedKeyId("image") && managedKeySupportsImage(key.group));
    const selectedVideo = activeKeys.find((key) => key.id === storedSelectedKeyId("video") && managedKeySupportsVideo(key.group));
    let imageKey = selectedImage || composite || chooseCapableKey(activeKeys, managedKeySupportsImage);
    let videoKey = selectedVideo || composite || chooseCapableKey(activeKeys, managedKeySupportsVideo);

    if (!imageKey) {
        const imageGroup = chooseGroup(groups, managedKeySupportsImage);
        if (!imageGroup) throw new Error("NO_IMAGE_CREATION_SERVICE");
        imageKey = await deps.createKey(session, imageGroup.platform === "composite" ? "创作密钥" : "图片创作", imageGroup.id);
        if (imageGroup.platform === "composite") videoKey = imageKey;
    }

    if (!videoKey) {
        const videoGroup = chooseGroup(groups, managedKeySupportsVideo);
        if (videoGroup) {
            videoKey = await deps.createKey(session, videoGroup.platform === "composite" ? "创作密钥" : "视频创作", videoGroup.id);
        }
    }

    return { imageKey, videoKey: videoKey || null, groups };
}

export async function switchManagedKey(session: CreateSession, key: CreateManagedKey, role: ManagedKeyRole, overrides: Partial<WorkspaceDependencies> = {}) {
    if (!isActiveKey(key)) throw new Error("该密钥当前不可用");
    const capable = role === "image" ? managedKeySupportsImage(key.group) : managedKeySupportsVideo(key.group);
    if (!capable) throw new Error(role === "image" ? "该密钥不支持生图" : "该密钥不支持生视频");
    rememberSelectedKey(role, key.id);
    return configureCreateWorkspace(session, overrides, { force: true });
}

export async function configureCreateWorkspace(
    session: CreateSession,
    overrides: Partial<WorkspaceDependencies> = {},
    options: { force?: boolean } = {},
): Promise<CreateWorkspaceConfiguration> {
    const now = Date.now();
    const cacheable = Object.keys(overrides).length === 0;
    if (
        cacheable &&
        !options.force &&
        workspaceConfigurationCache?.accessToken === session.accessToken &&
        now - workspaceConfigurationCache.createdAt <= WORKSPACE_CONFIGURATION_CACHE_MS
    ) {
        return workspaceConfigurationCache.promise;
    }

    const pending = configureCreateWorkspaceInternal(session, overrides);
    const cacheEntry = cacheable ? { accessToken: session.accessToken, createdAt: now, promise: pending } : null;
    if (cacheEntry) workspaceConfigurationCache = cacheEntry;
    try {
        return await pending;
    } catch (error) {
        if (cacheEntry && workspaceConfigurationCache === cacheEntry) workspaceConfigurationCache = null;
        throw error;
    }
}

async function configureCreateWorkspaceInternal(session: CreateSession, overrides: Partial<WorkspaceDependencies>): Promise<CreateWorkspaceConfiguration> {
    const deps = defaultDependencies(overrides);
    const { imageKey, videoKey } = await resolveManagedCredentials(session, deps);
    const [imageModels, videoModels] = await Promise.all([deps.loadModels(imageKey.key).catch(() => []), videoKey ? deps.loadModels(videoKey.key).catch(() => []) : Promise.resolve([])]);
    const videoGroupId = Number(videoKey?.group?.id ?? videoKey?.group_id ?? 0);
    const videoCapabilities = videoKey && deps.loadVideoCapabilities
        ? await deps.loadVideoCapabilities(session, videoGroupId).catch(() => ({}))
        : {};

    const imageGroupName = imageKey.group?.name?.trim() || "Create 图片";
    const videoGroupName = videoKey?.group?.name?.trim() || "Create 视频";
    const channels: ModelChannel[] = [];
    if (videoKey && videoKey.id === imageKey.id) {
        channels.push(channelFromModels(
            "create-managed",
            imageGroupName,
            imageKey.key,
            Array.from(new Set([...imageModels, ...videoModels])),
            ["image", "video"],
            videoCapabilities,
        ));
    } else {
        if (imageModels.length) {
            channels.push(channelFromModels("create-managed-image", imageGroupName, imageKey.key, imageModels, ["image"], videoCapabilities));
        }
        if (videoKey && videoModels.length) {
            channels.push(channelFromModels("create-managed-video", videoGroupName, videoKey.key, videoModels, ["video"], videoCapabilities));
        }
    }

    applyManagedChannels(channels);
    rememberSelectedKey("image", imageKey.id);
    rememberSelectedKey("video", videoKey?.id);
    configureCanvasCloud(session.accessToken);
    return {
        imageKey,
        videoKey,
        imageModels,
        videoModels,
        videoCapabilities,
        imageChannelModels: channels.flatMap((channel) => modelsFor(channel, "image")).length,
    };
}
