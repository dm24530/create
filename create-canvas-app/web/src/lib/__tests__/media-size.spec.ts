import { describe, expect, it } from "vitest";

import { computeMediaSize, inferMediaScale } from "../media-size";

describe("workbench image size presets", () => {
    it("keeps 2K and 4K tiers for the Web parity ratios", () => {
        expect(computeMediaSize("2k", "4:5")).toBe("1632x2048");
        expect(computeMediaSize("2k", "5:4")).toBe("2048x1632");
        expect(computeMediaSize("4k", "4:5")).toBe("2560x3200");
        expect(computeMediaSize("4k", "5:4")).toBe("3200x2560");
    });

    it("classifies the new presets at the requested resolution tier", () => {
        expect(inferMediaScale(computeMediaSize("2k", "4:5"))).toBe("2k");
        expect(inferMediaScale(computeMediaSize("4k", "5:4"))).toBe("4k");
    });
});
