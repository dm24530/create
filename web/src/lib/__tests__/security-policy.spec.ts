import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("renderer security policy", () => {
    it("defines a CSP without unsafe-eval and blocks object embeds", () => {
        const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

        expect(html).toMatch(/http-equiv="Content-Security-Policy"/i);
        expect(html).not.toContain("unsafe-eval");
        expect(html).toContain("object-src 'none'");
    });
});