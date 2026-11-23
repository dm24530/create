import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";
import type { AiConfig } from "@/types/image";

function config(): AiConfig {
    return {
        ...defaultConfig,
        baseUrl: "http://localhost:9898/v1",
        apiKey: "sk-local-test",
        apiFormat: "openai",
        model: "deepseek-v4.1-flash-1017",
        textModel: "deepseek-v4.1-flash-1017",
        channels: [{
            id: "managed-text",
            name: "managed-text",
            baseUrl: "http://localhost:9898/v1",
            apiKey: "sk-local-test",
            apiFormat: "openai",
            models: [{ name: "deepseek-v4.1-flash-1017", capability: "text" }],
        }],
        models: ["managed-text::deepseek-v4.1-flash-1017"],
    };
}

describe("image question text transport", () => {
    beforeEach(() => {
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
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("falls back to Chat Completions with image content when Responses is unavailable", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), {
                status: 502,
                headers: { "Content-Type": "application/json" },
            }))
            .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"红色"}}]}\n\ndata: [DONE]\n\n', {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
            }));
        vi.stubGlobal("fetch", fetchMock);
        const { requestImageQuestion } = await import("../image");
        const deltas: string[] = [];

        const answer = await requestImageQuestion(config(), [{
            role: "user",
            content: [
                { type: "text", text: "这张图片是什么颜色？" },
                { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
            ],
        }], (text) => deltas.push(text));

        expect(answer).toBe("红色");
        expect(deltas).toContain("红色");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9898/v1/responses");
        expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:9898/v1/chat/completions");
        const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(body.model).toBe("deepseek-v4.1-flash-1017");
        expect(body.messages[0].content).toEqual([
            { type: "text", text: "这张图片是什么颜色？" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
        ]);
    });
});