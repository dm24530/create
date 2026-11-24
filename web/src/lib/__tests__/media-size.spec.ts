import { describe, expect, it } from "vitest";

import { computeMediaSize, computeVideoSize, inferMediaScale, parseVideoResolution, videoResolutionDisplayLabel } from "../media-size";

describe("workbench image size presets", () => {
    it("keeps 2K and 4K tiers for the Web parity ratios", () => {
        expect(computeMediaSize("2k", "4:5")).toBe("1632x2048");
        expect(computeMediaSize("2k", "5:4")).toBe("2048x1632");
        expect(computeMediaSize("4k", "4:5")).toBe("2560x3200");
        expect(computeMediaSize("4k", "5:4")).toBe("3200x2560");
    });

    it("handles named video tiers such as 4k without dropping to 720p", () => {
        expect(parseVideoResolution("4k")).toBe("2160");
        expect(parseVideoResolution("2160p")).toBe("2160");
        expect(computeVideoSize("4k", "16:9")).toBe("3840x2160");
        expect(videoResolutionDisplayLabel("720")).toBe("720P");
        expect(videoResolutionDisplayLabel("4k")).toBe("4K");
    });

    it("classifies the new presets at the requested resolution tier", () => {
        expect(inferMediaScale(computeMediaSize("2k", "4:5"))).toBe("2k");
        expect(inferMediaScale(computeMediaSize("4k", "5:4"))).toBe("4k");
    });
});
