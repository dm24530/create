import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    CREATE_SESSION_KEYS,
    clearCreateSession,
    createLogin,
    createRefresh,
    readStoredCreateSession,
} from "../create-auth";
import { persistCreateSession, restoreCreateSession } from "../create-auth";

const user = {
    id: 7,
    username: "tester",
    email: "tester@example.com",
    role: "user",
};

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("create auth", () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.restoreAllMocks());

    it("logs in, persists the session, and reads it back", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
            code: 0,
            data: {
                access_token: "access",
                refresh_token: "refresh",
                expires_in: 3600,
                token_type: "Bearer",
                user,
            },
        }));

        const session = await createLogin(" tester@example.com ", "secret");

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/login");
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
            email: "tester@example.com",
            password: "secret",
        });
        expect(session.user.id).toBe(7);
        expect(readStoredCreateSession()?.accessToken).toBe("access");
        expect(localStorage.getItem(CREATE_SESSION_KEYS.refreshToken)).toBe("refresh");
    });

    it("refreshes the stored token pair", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
            code: 0,
            data: {
                access_token: "new-access",
                refresh_token: "new-refresh",
                expires_in: 1200,
                token_type: "Bearer",
            },
        }));

        const next = await createRefresh({
            accessToken: "old-access",
            refreshToken: "old-refresh",
            expiresAt: 0,
            user,
        });

        expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/refresh");
        expect(next.accessToken).toBe("new-access");
        expect(readStoredCreateSession()?.refreshToken).toBe("new-refresh");
    });

    it("keeps the account workspace available when refresh fails offline", async () => {
        persistCreateSession({
            accessToken: "expired",
            refreshToken: "refresh",
            expiresAt: 0,
            user,
        });
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
        await expect(restoreCreateSession()).resolves.toMatchObject({ user: { id: 7 } });
    });

    it("clears a stored session rejected by the backend", async () => {
        persistCreateSession({
            accessToken: "invalid",
            refreshToken: "refresh",
            expiresAt: Date.now() + 60_000,
            user,
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: 401, message: "Invalid token" }, 401));
        await expect(restoreCreateSession()).resolves.toBeNull();
        expect(readStoredCreateSession()).toBeNull();
    });

    it("clears all local session keys", () => {
        localStorage.setItem(CREATE_SESSION_KEYS.accessToken, "access");
        localStorage.setItem(CREATE_SESSION_KEYS.user, JSON.stringify(user));
        clearCreateSession();
        expect(readStoredCreateSession()).toBeNull();
    });
});
