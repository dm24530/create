import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

import { buildImageRetrySnapshot } from "../image-retry";

const reference: ReferenceImage = {
    id: "ref-1",
    name: "reference.png",
    type: "image/png",
    dataUrl: "data:image/png;base64,AAAA",
};

function config(overrides: Partial<AiConfig>): AiConfig {
    return {
        ...defaultConfig,
        baseUrl: "https://create.superai.sbs/v1",
        apiKey: "test-key",
        apiFormat: "openai",
        channels: [
            {
                id: "current-channel",
                name: "Current",
                baseUrl: "https://create.superai.sbs/v1",
                apiKey: "test-key",
                apiFormat: "openai",
                models: [{ name: "current-model", capability: "image" }],
            },
        ],
        model: "current-channel::current-model",
        imageModel: "current-channel::current-model",
        quality: "auto",
        size: "1024x1024",
        count: "1",
        ...overrides,
    };
}

describe("buildImageRetrySnapshot", () => {
    it("uses the failed task prompt, model, settings, and references instead of current form state", () => {
        const fallback = config({});
        const failedConfig = config({
            model: "old-channel::gpt-image-2",
            imageModel: "old-channel::gpt-image-2",
            quality: "high",
            size: "3840x2160",
            count: "2",
        });

        const snapshot = buildImageRetrySnapshot(
            {
                prompt: "失败时的提示词",
                model: "gpt-image-2",
                config: failedConfig,
                references: [reference],
            },
            fallback,
        );

        expect(snapshot).not.toBeNull();
        expect(snapshot?.text).toBe("失败时的提示词");
        expect(snapshot?.model).toBe("old-channel::gpt-image-2");
        expect(snapshot?.config).toMatchObject({
            model: "old-channel::gpt-image-2",
            imageModel: "old-channel::gpt-image-2",
            quality: "high",
            size: "3840x2160",
            count: "1",
        });
        expect(snapshot?.references).toEqual([reference]);
    });

    it("uses a fallback prompt only when a legacy failure record has no prompt, while keeping its model", () => {
        const fallback = config({});
        const snapshot = buildImageRetrySnapshot(
            {
                model: "gpt-image-2",
                config: {
                    model: "legacy-channel::gpt-image-2",
                    imageModel: "legacy-channel::gpt-image-2",
                    size: "1536x1024",
                },
            },
            fallback,
            "当前输入框提示词",
        );

        expect(snapshot).not.toBeNull();
        expect(snapshot?.text).toBe("当前输入框提示词");
        expect(snapshot?.model).toBe("legacy-channel::gpt-image-2");
        expect(snapshot?.config.size).toBe("1536x1024");
        expect(snapshot?.references).toEqual([]);
    });

    it("returns null when neither the failed task nor the current form contains a prompt", () => {
        expect(buildImageRetrySnapshot({}, config({}))).toBeNull();
    });
});