import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getClientRequestTiming, saveClientRequestTiming } from "@/services/client-request-timing";

describe("client request timing", () => {
    const values = new Map<string, string>();

    beforeEach(() => {
        values.clear();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stores both the raw and client-prefixed request ids", () => {
        saveClientRequestTiming("request-1", { prepareMs: 1200, generationMs: 36000, totalMs: 37200 });

        expect(getClientRequestTiming("request-1")).toEqual({ prepareMs: 1200, generationMs: 36000, totalMs: 37200 });
        expect(getClientRequestTiming("client:request-1")).toEqual({ prepareMs: 1200, generationMs: 36000, totalMs: 37200 });
    });
});
