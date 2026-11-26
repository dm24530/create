import { describe, expect, it } from "vitest";

import {
    buildImagePerformanceMap,
    buildPerformanceBars,
    findImagePerformance,
    formatPerformanceRate,
    performanceLevel,
    videoVendorLabel,
} from "../plaza-performance";

describe("plaza performance", () => {
    it("matches image performance by group and model", () => {
        const map = buildImagePerformanceMap([
            { group_id: 7, model: "GPT-Image-2", success_rate: 1, avg_duration_ms: 32000 },
            { group_id: 8, model: "gpt-image-2", success_rate: 0.5, avg_duration_ms: 40000 },
        ]);
        expect(findImagePerformance(map, 8, "gpt-image-2")?.success_rate).toBe(0.5);
    });

    it("builds 24 hourly bars and classifies success levels", () => {
        const endAt = "2026-11-26T10:00:00+08:00";
        const bars = buildPerformanceBars({
            range: "24h",
            bucket: "hour",
            start_at: "",
            end_at: endAt,
            models: [],
            series: [{ bucket_start: "2026-11-26T08:00:00+08:00", success_rate: 0.8 }],
            group_id: 1,
            model: "gpt-image-2",
            success_rate: 0.8,
            avg_duration_ms: 1000,
        }, endAt);
        expect(bars).toHaveLength(24);
        expect(bars[21]?.rate).toBe(0.8);
        expect(performanceLevel(0.8)).toBe("good");
        expect(performanceLevel(0.5)).toBe("warning");
        expect(performanceLevel(0.2)).toBe("bad");
    });

    it("formats rates and video vendors", () => {
        expect(formatPerformanceRate(1)).toBe("100%");
        expect(formatPerformanceRate(0.856)).toBe("85.6%");
        expect(videoVendorLabel("seedance-2.0-fast")).toBe("Seedance");
        expect(videoVendorLabel("minimax H3")).toBe("MiniMax");
    });
});