import { CreateApiError, createRequest, type CreateRequestOptions } from "@/services/create-api";

export const CREATE_SESSION_KEYS = {
    accessToken: "create-canvas:access-token",
    refreshToken: "create-canvas:refresh-token",
    expiresAt: "create-canvas:expires-at",
    user: "create-canvas:user",
} as const;

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export type CreateUser = {
    id: number;
    username: string;
    email: string;
    display_name?: string | null;
    avatar_url?: string | null;
    role: "admin" | "user" | string;
    balance?: number;
    status?: string;
};

export type CreateSession = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    user: CreateUser;
};

type AuthPayload = {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    user: CreateUser;
    requires_2fa?: boolean;
};

type RefreshPayload = {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
};

function createSession(payload: AuthPayload): CreateSession {
    if (!payload.access_token || !payload.user?.id) {
        throw new Error("Create login response is missing a valid session");
    }
    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || "",
        expiresAt: Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000,
        user: payload.user,
    };
}

export function persistCreateSession(session: CreateSession) {
    localStorage.setItem(CREATE_SESSION_KEYS.accessToken, session.accessToken);
    localStorage.setItem(CREATE_SESSION_KEYS.refreshToken, session.refreshToken);
    localStorage.setItem(CREATE_SESSION_KEYS.expiresAt, String(session.expiresAt));
    localStorage.setItem(CREATE_SESSION_KEYS.user, JSON.stringify(session.user));
}

export function clearCreateSession() {
    Object.values(CREATE_SESSION_KEYS).forEach((key) => localStorage.removeItem(key));
}

export function readStoredCreateSession(): CreateSession | null {
    const accessToken = localStorage.getItem(CREATE_SESSION_KEYS.accessToken) || "";
    const refreshToken = localStorage.getItem(CREATE_SESSION_KEYS.refreshToken) || "";
    const expiresAt = Number(localStorage.getItem(CREATE_SESSION_KEYS.expiresAt) || 0);
    const userText = localStorage.getItem(CREATE_SESSION_KEYS.user) || "";
    if (!accessToken || !userText) return null;
    try {
        const user = JSON.parse(userText) as CreateUser;
        if (!user?.id) return null;
        return { accessToken, refreshToken, expiresAt, user };
    } catch {
        return null;
    }
}

export function isCreateSessionFresh(session: CreateSession, bufferMs = 120_000) {
    return Boolean(session.accessToken && session.expiresAt > Date.now() + bufferMs);
}

export async function createLogin(email: string, password: string): Promise<CreateSession> {
    const payload = await createRequest<AuthPayload>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
    });
    if (payload.requires_2fa) {
        throw new Error("该账号需要二次验证，请先在 Web 端完成登录后再使用当前版本");
    }
    const session = createSession(payload);
    persistCreateSession(session);
    return session;
}

export async function createRefresh(session: CreateSession): Promise<CreateSession> {
    if (!session.refreshToken) throw new Error("登录会话已过期");
    const payload = await createRequest<RefreshPayload>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refreshToken }),
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
    });
    const next: CreateSession = {
        ...session,
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || session.refreshToken,
        expiresAt: Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000,
    };
    persistCreateSession(next);
    return next;
}

export async function createMe(session: CreateSession): Promise<CreateUser> {
    return createRequest<CreateUser>("/auth/me", { accessToken: session.accessToken, timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
}

export async function createLogout(session: CreateSession): Promise<void> {
    if (session.refreshToken) {
        try {
            await createRequest("/auth/logout", {
                method: "POST",
                accessToken: session.accessToken,
                body: JSON.stringify({ refresh_token: session.refreshToken }),
            timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
            });
        } catch {
            // Local logout must still succeed when the server is unavailable.
        }
    }
    clearCreateSession();
}

export function createAuthorizedOptions(session: CreateSession, options: CreateRequestOptions = {}): CreateRequestOptions {
    return { ...options, accessToken: session.accessToken };
}
export async function restoreCreateSession(): Promise<CreateSession | null> {
    let stored = readStoredCreateSession();
    if (!stored) return null;
    if (!isCreateSessionFresh(stored) && stored.refreshToken) {
        try {
            stored = await createRefresh(stored);
        } catch (error) {
            if (error instanceof CreateApiError && error.status >= 400 && error.status < 500) {
                clearCreateSession();
                return null;
            }
            return stored;
        }
    }
    try {
        const user = await createMe(stored);
        stored = { ...stored, user };
        persistCreateSession(stored);
        return stored;
    } catch (error) {
        if (error instanceof CreateApiError && error.status >= 400 && error.status < 500) {
            clearCreateSession();
            return null;
        }
        // Preserve the last account workspace while the backend is unreachable.
        return stored;
    }
}
