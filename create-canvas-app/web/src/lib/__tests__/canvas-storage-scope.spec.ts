import { afterEach, describe, expect, it, vi } from "vitest";

describe("canvas storage scope migration", () => {
    afterEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it("claims images left in the legacy default scope for the signed-in user", async () => {
        localStorage.setItem("create-canvas:user", JSON.stringify({ id: 7 }));
        vi.resetModules();
        const { legacyCanvasStorageKeys } = await import("../canvas-storage-scope");

        expect(legacyCanvasStorageKeys("image:legacy")).toContain("scope:default:image:legacy");
    });

    it("keeps the current scoped key out of the legacy fallback list", async () => {
        localStorage.setItem("create-canvas:user", JSON.stringify({ id: 7 }));
        vi.resetModules();
        const { legacyCanvasStorageKeys, scopedCanvasStorageKey } = await import("../canvas-storage-scope");

        expect(legacyCanvasStorageKeys("image:legacy")).not.toContain(scopedCanvasStorageKey("image:legacy"));
    });
});