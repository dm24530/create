import { afterEach, describe, expect, it, vi } from "vitest";

import { createRequest } from "@/services/create-api";

describe("createRequest", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("rejects with a timeout instead of leaving workspace loading forever", async () => {
        vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })));

        const outcome = await Promise.race([
            createRequest("/keys", { timeoutMs: 20 } as Parameters<typeof createRequest>[1]).then(
                () => "resolved",
                () => "rejected",
            ),
            new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 150)),
        ]);

        expect(outcome).toBe("rejected");
    });
});
