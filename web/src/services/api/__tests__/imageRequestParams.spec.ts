import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import axios from "axios";
import type { AiConfig } from "@/types/image";

vi.mock("axios", () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
    isCancel: vi.fn(() => false),
    isAxiosError: vi.fn(() => false),
}));

function config(overrides: Partial<AiConfig>): AiConfig {
    return {
        baseUrl: "http://localhost:9899/v1",
        apiKey: "sk-test",
        apiFormat: "openai",
        model: "gpt-image-2",
        imageModel: "gpt-image-2",
        channels: [],
        models: ["gpt-image-2"],
        systemPrompt: "",
        size: "3840x2160",
        quality: "auto",
        outputFormat: "png",
        background: "",
        count: "1",
        ...overrides,
    } as AiConfig;
}

describe("image request parameter forwarding", () => {
    let requestGeneration: typeof import("../image").requestGeneration;
    let IMAGE_REQUEST_TIMEOUT_MS: typeof import("../image").IMAGE_REQUEST_TIMEOUT_MS;

    beforeEach(async () => {
        const values = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        });
        vi.stubGlobal("window", {
            createDesktop: { isDesktop: true },
            location: { origin: "http://localhost:3001" },
        });
        ({ requestGeneration, IMAGE_REQUEST_TIMEOUT_MS } = await import("../image"));
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it("allows slow 4K image responses and downloads for ten minutes", () => {
        expect(IMAGE_REQUEST_TIMEOUT_MS).toBe(10 * 60_000);
    });

    it("forwards exact image size and format through the OpenAI-compatible image endpoint", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { data: [{ b64_json: "aW1hZ2U=", mime_type: "image/png" }] },
        });

        await requestGeneration(
            config({
                size: "3840x2160",
                outputFormat: "png",
                background: "transparent",
            }),
            "draw a cat",
            { clientRequestId: "client-image-test" },
        );

        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, body, options] = vi.mocked(axios.post).mock.calls[0]!;
        expect(url).toBe("http://localhost:9899/v1/images/generations");
        expect(body).toMatchObject({
            model: "gpt-image-2",
            prompt: "draw a cat",
            n: 1,
            size: "3840x2160",
            output_format: "png",
            background: "transparent",
        });
        expect((body as Record<string, unknown>).quality).toBeUndefined();
        expect(options?.headers).toMatchObject({
            Authorization: "Bearer sk-test",
            "X-Client-Request-ID": "client-image-test",
            "X-Create-Image-Passthrough": "local",
        });
    });

    it("notifies when the image response download starts", async () => {
        const onDownloadStart = vi.fn();
        vi.mocked(axios.post).mockImplementationOnce(async (_url, _body, options) => {
            options?.onDownloadProgress?.({ loaded: 1, total: 10 });
            return { data: { data: [{ b64_json: "aW1hZ2U=", mime_type: "image/png" }] } };
        });

        await requestGeneration(config({}), "draw a cat", { onDownloadStart });

        expect(onDownloadStart).toHaveBeenCalledTimes(1);
    });

    it("keeps the server request id for usage timing correlation", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { data: [{ b64_json: "aW1hZ2U=", mime_type: "image/png" }] },
            headers: { "x-client-request-id": "server-request-1" },
        });

        const [image] = await requestGeneration(config({}), "draw a cat");

        expect(image?.serverRequestId).toBe("server-request-1");
    });

    it("forwards download bytes, total, and rate", async () => {
        const onDownloadProgress = vi.fn();
        vi.mocked(axios.post).mockImplementationOnce(async (_url, _body, options) => {
            options?.onDownloadProgress?.({ loaded: 5_000_000, total: 10_000_000, rate: 2_000_000 });
            return { data: { data: [{ b64_json: "aW1hZ2U=", mime_type: "image/png" }] } };
        });

        await requestGeneration(config({}), "draw a cat", { onDownloadProgress });

        expect(onDownloadProgress).toHaveBeenCalledWith({
            loaded: 5_000_000,
            total: 10_000_000,
            bytesPerSecond: 2_000_000,
        });
    });


    it("prefers a full url over a render preview and marks preview-only responses", async () => {
        vi.mocked(axios.post)
            .mockResolvedValueOnce({
                data: {
                    data: [{
                        url: "https://cdn.example.com/full.png",
                        display_url: "data:image/jpeg;base64,cHJldmlldw==",
                        preview_data_url: "data:image/jpeg;base64,cHJldmlldw==",
                        mime_type: "image/png",
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    data: [{
                        display_url: "data:image/jpeg;base64,cHJldmlldw==",
                        preview_data_url: "data:image/jpeg;base64,cHJldmlldw==",
                        mime_type: "image/jpeg",
                    }],
                },
            });

        const [preferred] = await requestGeneration(config({ outputFormat: "png" }), "draw a cat");
        if (!preferred) throw new Error("expected preferred image");
        expect(preferred.dataUrl).toBe("https://cdn.example.com/full.png");
        expect(preferred.previewOnly).toBe(false);

        const [preview] = await requestGeneration(config({ outputFormat: "jpeg" }), "draw a cat");
        if (!preview) throw new Error("expected preview image");
        expect(preview.dataUrl).toBe("data:image/jpeg;base64,cHJldmlldw==");
        expect(preview.previewOnly).toBe(true);
    });

    it("maps a 4K Gemini selection to aspectRatio and imageSize", async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: {
                candidates: [{
                    content: {
                        parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }],
                    },
                }],
            },
        });

        await requestGeneration(
            config({
                model: "gemini-3-pro-image",
                imageModel: "gemini-3-pro-image",
                models: ["gemini-3-pro-image"],
                size: "3840x2160",
            }),
            "draw a cat",
        );

        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, body, options] = vi.mocked(axios.post).mock.calls[0]!;
        expect(url).toBe("http://localhost:9899/v1beta/models/gemini-3-pro-image:generateContent");
        expect(body).toMatchObject({
            contents: [{ role: "user", parts: [{ text: "draw a cat" }] }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                    aspectRatio: "16:9",
                    imageSize: "4K",
                },
            },
        });
        expect(options?.headers).toMatchObject({
            "x-goog-api-key": "sk-test",
            "X-Create-Image-Passthrough": "local",
        });
    });
});
