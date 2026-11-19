import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestGeneration } from "../image";
import type { AiConfig } from "@/types/image";

describe("image network reconnect integration", () => {
    let server: Server;
    let port = 0;
    let attempts = 0;
    const requestIds: string[] = [];

    beforeAll(async () => {
        server = createServer((request, response) => {
            const corsHeaders = {
                "Access-Control-Allow-Origin": "http://localhost:3000",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Request-ID, X-Create-Image-Passthrough",
            };
            if (request.method === "OPTIONS") {
                response.writeHead(204, corsHeaders);
                response.end();
                return;
            }
            attempts += 1;
            requestIds.push(String(request.headers["x-client-request-id"] || ""));
            if (attempts === 1) {
                request.socket.destroy();
                return;
            }
            request.resume();
            response.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
            response.end(JSON.stringify({
                data: [{ b64_json: "iVBORw0KGgo=", mime_type: "image/png" }],
            }));
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("test server did not bind");
        port = address.port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });

    it("reconnects after the first connection is dropped", async () => {
        const config: AiConfig = {
            baseUrl: `http://127.0.0.1:${port}/v1`,
            apiKey: "sk-test",
            apiFormat: "openai",
            model: "gpt-image-2",
            imageModel: "gpt-image-2",
            channels: [],
            models: ["gpt-image-2"],
            systemPrompt: "",
            size: "1024x1024",
            quality: "auto",
            outputFormat: "png",
            background: "",
            count: "1",
        };

        const images = await requestGeneration(config, "network switch test", {
            clientRequestId: "network-switch-integration",
        });

        expect(images).toHaveLength(1);
        expect(images[0]?.dataUrl).toContain("data:image/png;base64,");
        expect(attempts).toBe(2);
        expect(requestIds).toEqual(["network-switch-integration", "network-switch-integration"]);
    }, 15000);
});
