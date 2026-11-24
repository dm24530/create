import { describe, expect, it } from "vitest";

import { isPluginAllowedForMode } from "@/lib/canvas/plugin-loader";

describe("canvas plugin runtime policy", () => {
    it("allows only bundled local plugins in product mode", () => {
        expect(isPluginAllowedForMode({ local: true }, true)).toBe(true);
        expect(isPluginAllowedForMode({ local: false }, true)).toBe(false);
        expect(isPluginAllowedForMode({}, true)).toBe(false);
        expect(isPluginAllowedForMode({ local: false }, false)).toBe(true);
    });
});