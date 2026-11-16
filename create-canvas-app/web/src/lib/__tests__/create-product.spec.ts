import { describe, expect, it } from "vitest";

import {
    createApiBaseUrl,
    createApiUrl,
    createGatewayBaseUrl,
    createGatewayUrl,
    isCreateProductMode,
} from "../create-product";

describe("create product runtime", () => {
    it("uses the Create API and gateway paths by default", () => {
        expect(isCreateProductMode()).toBe(true);
        expect(createApiBaseUrl()).toBe("/api/v1");
        expect(createGatewayBaseUrl()).toBe("/v1");
        expect(createApiUrl("/auth/login")).toBe("/api/v1/auth/login");
        expect(createGatewayUrl("/models")).toBe("/v1/models");
    });
});

