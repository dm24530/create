import { fetchImageModels } from "@/services/api/image";
import { createRequest } from "@/services/create-api";
import type { CreateSession } from "@/services/create-auth";
import { createGatewayBaseUrl } from "@/lib/create-product";
import { configureCanvasCloud } from "@/services/canvas-cloud";
import {
    createModelChannel,
    guessCapability,
    modelOptionsFromChannels,
    selectableModelsByCapability,
    useConfigStore,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

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
};

type KeysPage = { items?: CreateManagedKey[] };

type WorkspaceDependencies = {
    listKeys: (session: CreateSession) => Promise<CreateManagedKey[]>;
    listGroups: (session: CreateSession) => Promise<CreateManagedGroup[]>;
    createKey: (session: CreateSession, name: string, groupId: number) => Promise<CreateManagedKey>;
    loadModels: (apiKey: string) => Promise<string[]>;
};

function supportsImage(group?: CreateManagedGroup | null) {
    return group?.allow_image_generation === true;
}

function supportsVideo(group?: CreateManagedGroup | null) {
    if (!group) return false;
    return Boolean(
        group.video_capable ||
        group.platform === "composite" ||
        group.video_price_480p != null ||
        group.video_price_720p != null ||
        group.video_price_1080p != null,
    );
}

function isActiveKey(key: CreateManagedKey) {
    return key.status === "active" && Boolean(key.key?.trim());
}

function chooseCompositeKey(keys: CreateManagedKey[]) {
    return keys.find((key) => key.group?.platform === "composite" && supportsImage(key.group) && supportsVideo(key.group));
}

function chooseCapableKey(keys: CreateManagedKey[], supports: (group?: CreateManagedGroup | null) => boolean) {
    return keys.find((key) => supports(key.group));
}

function chooseGroup(groups: CreateManagedGroup[], supports: (group?: CreateManagedGroup | null) => boolean) {
    return groups
        .filter((group) => supports(group))
        .sort((left, right) => Number(right.platform === "composite") - Number(left.platform === "composite"))[0] || null;
}

function modelsFor(channel: ModelChannel, capability: ModelCapability) {
    return channel.models.filter((model) => model.capability === capability);
}

function channelFromModels(id: string, name: string, apiKey: string, models: string[], capabilities?: ModelCapability[]) {
    const allowed = capabilities ? new Set(capabilities) : null;
    return createModelChannel({
        id,
        name,
        baseUrl: createGatewayBaseUrl(),
        apiKey,
        apiFormat: "openai",
        models: models.map((model) => ({ name: model, capability: guessCapability(model) }))
            .filter((model) => !allowed || allowed.has(model.capability)),
    });
}

export async function resolveManagedCredentials(
    session: CreateSession,
    deps: WorkspaceDependencies,
): Promise<{ imageKey: CreateManagedKey; videoKey: CreateManagedKey | null; groups: CreateManagedGroup[] }> {
    const [initialKeys, groups] = await Promise.all([deps.listKeys(session), deps.listGroups(session)]);
    const activeKeys = initialKeys.filter(isActiveKey);
    const allKeys = [...activeKeys];
    const composite = chooseCompositeKey(activeKeys);
    let imageKey = composite || chooseCapableKey(activeKeys, supportsImage);
    let videoKey = composite || chooseCapableKey(activeKeys, supportsVideo);

    if (!imageKey) {
        const imageGroup = chooseGroup(groups, supportsImage);
        if (!imageGroup) throw new Error("NO_IMAGE_CREATION_SERVICE");
        imageKey = await deps.createKey(session, imageGroup.platform === "composite" ? "创作密钥" : "图片创作", imageGroup.id);
        allKeys.push(imageKey);
        if (imageGroup.platform === "composite") videoKey = imageKey;
    }

    if (!videoKey) {
        const videoGroup = chooseGroup(groups, supportsVideo);
        if (videoGroup) {
            videoKey = await deps.createKey(session, videoGroup.platform === "composite" ? "创作密钥" : "视频创作", videoGroup.id);
            allKeys.push(videoKey);
        }
    }

    return { imageKey, videoKey: videoKey || null, groups };
}

export async function configureCreateWorkspace(
    session: CreateSession,
    overrides: Partial<WorkspaceDependencies> = {},
) {
    const deps: WorkspaceDependencies = {
        listKeys: async (activeSession) => {
            const page = await createRequest<KeysPage>("/keys?page=1&page_size=100&status=active", {
                accessToken: activeSession.accessToken,
            });
            return page.items || [];
        },
        listGroups: (activeSession) => createRequest<CreateManagedGroup[]>("/groups/available", {
            accessToken: activeSession.accessToken,
        }),
        createKey: (activeSession, name, groupId) => createRequest<CreateManagedKey>("/keys", {
            method: "POST",
            accessToken: activeSession.accessToken,
            body: JSON.stringify({ name, group_id: groupId }),
        }),
        loadModels: (apiKey) => fetchImageModels({
            baseUrl: createGatewayBaseUrl(),
            apiKey,
            apiFormat: "openai",
        }),
        ...overrides,
    };

    const { imageKey, videoKey } = await resolveManagedCredentials(session, deps);
    const [imageModels, videoModels] = await Promise.all([
        deps.loadModels(imageKey.key).catch(() => []),
        videoKey ? deps.loadModels(videoKey.key).catch(() => []) : Promise.resolve([]),
    ]);

    const channels: ModelChannel[] = [];
    if (videoKey && videoKey.id === imageKey.id) {
        const combined = channelFromModels("create-managed", "Create", imageKey.key, Array.from(new Set([...imageModels, ...videoModels])));
        channels.push(combined);
    } else {
        if (imageModels.length) channels.push(channelFromModels("create-managed-image", "Create 图片", imageKey.key, imageModels));
        if (videoKey && videoModels.length) channels.push(channelFromModels("create-managed-video", "Create 视频", videoKey.key, videoModels));
    }

    if (channels.length) {
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
        nextConfig.imageModel = selectableModelsByCapability(nextConfig, "image")[0] || "";
        nextConfig.videoModel = selectableModelsByCapability(nextConfig, "video")[0] || "";
        nextConfig.textModel = selectableModelsByCapability(nextConfig, "text")[0] || "";
        nextConfig.audioModel = selectableModelsByCapability(nextConfig, "audio")[0] || "";
        nextConfig.model = nextConfig.imageModel || nextConfig.videoModel || nextConfig.textModel;
        useConfigStore.setState({ config: nextConfig, isConfigOpen: false });
    }

    configureCanvasCloud(session.accessToken);
    return {
        imageModels,
        videoModels,
        imageChannelModels: channels.flatMap((channel) => modelsFor(channel, "image")).length,
    };
}


