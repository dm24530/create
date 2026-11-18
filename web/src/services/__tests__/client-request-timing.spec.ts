import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildClientRequestTiming, getClientRequestTiming, saveClientRequestTiming } from "@/services/client-request-timing";

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

    it("separates preparation, generation, and download time", () => {
        expect(buildClientRequestTiming({
            prepareStartedAt: 1_000,
            requestStartedAt: 1_800,
            downloadStartedAt: 36_000,
            completedAt: 44_600,
        })).toEqual({ prepareMs: 800, generationMs: 34_200, downloadMs: 8_600, totalMs: 43_600 });
    });

    it("keeps generation time complete when download progress is unavailable", () => {
        expect(buildClientRequestTiming({
            prepareStartedAt: 1_000,
            requestStartedAt: 1_800,
            completedAt: 36_000,
        })).toEqual({ prepareMs: 800, generationMs: 34_200, downloadMs: 0, totalMs: 35_000 });
    });

    it("reads legacy timing entries without a download phase", () => {
        values.set("create-canvas:client-request-timings", JSON.stringify({
            legacy: { prepareMs: 1200, generationMs: 36000, totalMs: 37200 },
        }));

        expect(getClientRequestTiming("legacy")).toEqual({
            prepareMs: 1200,
            generationMs: 36000,
            downloadMs: 0,
            totalMs: 37200,
        });
    });

    it("stores both the raw and client-prefixed request ids", () => {
        saveClientRequestTiming("request-1", { prepareMs: 1200, generationMs: 36000, downloadMs: 8700, totalMs: 45900 });

        expect(getClientRequestTiming("request-1")).toEqual({ prepareMs: 1200, generationMs: 36000, downloadMs: 8700, totalMs: 45900 });
        expect(getClientRequestTiming("client:request-1")).toEqual({ prepareMs: 1200, generationMs: 36000, downloadMs: 8700, totalMs: 45900 });
    });
});
