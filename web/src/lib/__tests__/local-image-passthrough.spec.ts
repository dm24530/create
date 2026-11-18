import { afterEach, describe, expect, it } from "vitest";

import { isLocalImagePassthrough, localImagePassthroughHeaders } from "../local-image-passthrough";

describe("local image passthrough", () => {
    afterEach(() => {
        delete (window as Window & { createDesktop?: unknown }).createDesktop;
    });

    it("stays disabled for the remote web client", () => {
        expect(isLocalImagePassthrough()).toBe(false);
        expect(localImagePassthroughHeaders()).toEqual({});
    });

    it("marks desktop image requests as passthrough", () => {
        Object.assign(window, { createDesktop: { isDesktop: true } });
        expect(isLocalImagePassthrough()).toBe(true);
        expect(localImagePassthroughHeaders()).toEqual({ "X-Create-Image-Passthrough": "local" });
    });
});
