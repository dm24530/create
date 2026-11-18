import { describe, expect, it } from "vitest";

import { defaultConfig, normalizeModelOptionValue, resolveModelForCapability, useConfigStore, type AiConfig } from "../use-config-store";

function configWithManagedImageModel(): AiConfig {
    return {
        ...defaultConfig,
        channels: [
            {
                id: "create-managed",
                name: "Create",
                baseUrl: "/v1",
                apiKey: "sk-current",
                apiFormat: "openai",
                models: [{ name: "gpt-image-2", capability: "image" }],
            },
        ],
        model: "create-managed::gpt-image-2",
        imageModel: "create-managed::gpt-image-2",
    };
}

describe("managed model recovery", () => {
    it("moves a stale managed-channel model to the current channel", () => {
        const config = configWithManagedImageModel();

        expect(resolveModelForCapability(config, "old-managed-channel::gpt-image-2", "image")).toBe("create-managed::gpt-image-2");
        expect(normalizeModelOptionValue("old-managed-channel::gpt-image-2", config.channels)).toBe("create-managed::gpt-image-2");
    });
});

describe("Create mode configuration", () => {
    it("does not open the legacy configuration dialog", () => {
        useConfigStore.setState({ isConfigOpen: false, shouldPromptContinue: false });

        useConfigStore.getState().openConfigDialog(true);

        const state = useConfigStore.getState();
        expect(state.isConfigOpen).toBe(false);
        expect(state.shouldPromptContinue).toBe(false);
    });
});
