import { describe, expect, it } from "vitest";

import { buildExportManifest, createZipBlob, planSliceRanges, verifyExportedZip } from "@/lib/product-detail/export";
import type { PageSpec } from "@/types/product-detail";

const page: PageSpec = { id: "spec-1", pageId: "page-1", width: 750, height: 1000, background: "#fff", layers: [], overflowStatus: "ok", validation: [] };

describe("product detail export", () => {
    it("plans slices without exceeding the maximum height", () => {
        expect(planSliceRanges(4200, 2000)).toEqual([
            { y: 0, height: 2000 },
            { y: 2000, height: 2000 },
            { y: 4000, height: 200 },
        ]);
    });

    it("builds an export manifest with page dimensions", () => {
        const manifest = buildExportManifest("project-1", "便携榨汁杯", [page]);
        expect(manifest.pageCount).toBe(1);
        expect(manifest.pages[0].width).toBe(750);
        expect(manifest.totalHeight).toBe(1000);
    });

    it("verifies every expected file after creating the ZIP", async () => {
        const files = {
            "pages/01.jpg": new Uint8Array([1, 2, 3]),
            "manifest.json": new TextEncoder().encode("{}"),
        };
        const result = await verifyExportedZip(createZipBlob(files), Object.keys(files));
        expect(result.entryCount).toBe(2);
        expect(result.totalBytes).toBeGreaterThan(0);
    });

    it("fails verification when an expected export file is missing", async () => {
        const blob = createZipBlob({ "manifest.json": new TextEncoder().encode("{}") });
        await expect(verifyExportedZip(blob, ["manifest.json", "pages/01.jpg"])).rejects.toThrow("缺少");
    });
});
