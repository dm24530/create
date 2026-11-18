import { describe, expect, it, vi } from "vitest";

import { beforeEach } from "vitest";
import { configureCreateWorkspace, getManagedKeySelection, resolveManagedCredentials, switchManagedKey, type CreateManagedGroup, type CreateManagedKey } from "../create-managed-channel";
import type { CreateSession } from "../create-auth";
import { useConfigStore } from "@/stores/use-config-store";

const session: CreateSession = {
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
    user: { id: 1, username: "u", email: "u@example.com", role: "user" },
};

const imageGroup: CreateManagedGroup = { id: 10, name: "image", platform: "openai", allow_image_generation: true };
const videoGroup: CreateManagedGroup = { id: 11, name: "video", platform: "grok", video_capable: true };
const compositeGroup: CreateManagedGroup = { id: 12, name: "composite", platform: "composite", allow_image_generation: true, video_capable: true };

function key(id: number, group: CreateManagedGroup): CreateManagedKey {
    return { id, key: `sk-${id}`, name: `key-${id}`, status: "active", group };
}

describe("managed Create credentials", () => {
    beforeEach(() => localStorage.clear());
    it("reuses a composite key for image and video", async () => {
        const composite = key(1, compositeGroup);
        const result = await resolveManagedCredentials(session, {
            listKeys: vi.fn().mockResolvedValue([composite]),
            listGroups: vi.fn().mockResolvedValue([imageGroup, videoGroup]),
            createKey: vi.fn(),
            loadModels: vi.fn(),
        });
        expect(result.imageKey.id).toBe(1);
        expect(result.videoKey?.id).toBe(1);
    });

    it("reuses separate image and video keys", async () => {
        const result = await resolveManagedCredentials(session, {
            listKeys: vi.fn().mockResolvedValue([key(1, imageGroup), key(2, videoGroup)]),
            listGroups: vi.fn().mockResolvedValue([imageGroup, videoGroup]),
            createKey: vi.fn(),
            loadModels: vi.fn(),
        });
        expect(result.imageKey.id).toBe(1);
        expect(result.videoKey?.id).toBe(2);
    });

    it("creates the missing capable key", async () => {
        const createKey = vi.fn().mockImplementation(async (_session, name, groupId) => key(3, groupId === 10 ? imageGroup : videoGroup));
        const result = await resolveManagedCredentials(session, {
            listKeys: vi.fn().mockResolvedValue([]),
            listGroups: vi.fn().mockResolvedValue([imageGroup, videoGroup]),
            createKey,
            loadModels: vi.fn(),
        });
        expect(createKey).toHaveBeenCalledTimes(2);
        expect(createKey).toHaveBeenNthCalledWith(1, session, "图片创作", 10);
        expect(createKey).toHaveBeenNthCalledWith(2, session, "视频创作", 11);
        expect(result.imageKey.id).toBe(3);
    });

    it("fails when no image-capable group exists", async () => {
        await expect(resolveManagedCredentials(session, {
            listKeys: vi.fn().mockResolvedValue([]),
            listGroups: vi.fn().mockResolvedValue([videoGroup]),
            createKey: vi.fn(),
            loadModels: vi.fn(),
        })).rejects.toThrow("NO_IMAGE_CREATION_SERVICE");
    });

    it("configures image and video models into the canvas workbench", async () => {
        await configureCreateWorkspace(session, {
            listKeys: vi.fn().mockResolvedValue([key(1, compositeGroup)]),
            listGroups: vi.fn().mockResolvedValue([compositeGroup]),
            createKey: vi.fn(),
            loadModels: vi.fn().mockResolvedValue(["gpt-image-2", "grok-imagine-video"]),
        });
        const config = useConfigStore.getState().config;
        expect(config.channels[0]?.id).toBe("create-managed");
        expect(config.imageModel).toContain("gpt-image-2");
        expect(config.videoModel).toContain("grok-imagine-video");
    });

    it("keeps image and video channels scoped to their own capabilities", async () => {
        const deps = {
            listKeys: vi.fn().mockResolvedValue([key(1, imageGroup), key(2, videoGroup)]),
            listGroups: vi.fn().mockResolvedValue([imageGroup, videoGroup]),
            createKey: vi.fn(),
            loadModels: vi.fn().mockResolvedValue(["gpt-image-2", "muse-video", "seedance-2.0"]),
        }
        await configureCreateWorkspace(session, deps)
        const config = useConfigStore.getState().config
        const imageChannel = config.channels.find((channel) => channel.id === "create-managed-image")
        const videoChannel = config.channels.find((channel) => channel.id === "create-managed-video")

        expect(imageChannel?.models.map((model) => `${model.name}:${model.capability}`)).toEqual(["gpt-image-2:image"])
        expect(videoChannel?.models.map((model) => `${model.name}:${model.capability}`)).toEqual([
            "muse-video:video",
            "seedance-2.0:video",
        ])
    })

    it("selects image and video keys independently", async () => {
        const keys = [key(1, imageGroup), key(2, imageGroup), key(3, videoGroup)];
        const deps = {
            listKeys: vi.fn().mockResolvedValue(keys),
            listGroups: vi.fn().mockResolvedValue([imageGroup, videoGroup]),
            createKey: vi.fn(),
            loadModels: vi.fn().mockResolvedValue(["gpt-image-2", "grok-imagine-video"]),
        };
        await configureCreateWorkspace(session, deps);
        expect(getManagedKeySelection()).toEqual({ imageKeyId: 1, videoKeyId: 3 });

        await switchManagedKey(session, keys[1], "image", deps);
        expect(getManagedKeySelection()).toEqual({ imageKeyId: 2, videoKeyId: 3 });
        const config = useConfigStore.getState().config;
        expect(config.channels.find((channel) => channel.id === "create-managed-image")?.apiKey).toBe("sk-2");
        expect(config.channels.find((channel) => channel.id === "create-managed-video")?.apiKey).toBe("sk-3");
    });
});
