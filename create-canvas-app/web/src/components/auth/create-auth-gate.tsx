import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Alert, Spin } from "antd";

import { CreateLoginForm } from "@/components/auth/create-login-form";
import { restoreCreateSession, type CreateSession } from "@/services/create-auth";
import { useUserStore } from "@/stores/use-user-store";

type CreateAuthGateProps = {
    children: ReactNode;
    onSessionReady?: (session: CreateSession) => Promise<unknown> | void;
};

export function CreateAuthGate({ children, onSessionReady }: CreateAuthGateProps) {
    const [session, setSession] = useState<CreateSession | null>(null);
    const [booting, setBooting] = useState(true);
    const [workspaceError, setWorkspaceError] = useState("");
    const setStoredSession = useUserStore((state) => state.setSession);

    const applySession = (next: CreateSession) => {
        setStoredSession(next);
        setSession(next);
        setWorkspaceError("");
        if (onSessionReady) {
            void Promise.resolve(onSessionReady(next)).catch((cause: unknown) => {
                setWorkspaceError(cause instanceof Error ? cause.message : "初始化创作服务失败");
            });
        }
    };

    useEffect(() => {
        let cancelled = false;
        void restoreCreateSession().then((stored) => {
            if (cancelled) return;
            if (stored) applySession(stored);
            if (!cancelled) setBooting(false);
        });
        return () => {
            cancelled = true;
        };
        // The callback is intentionally captured for initial bootstrap only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (booting) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-stone-950">
                <Spin size="large" />
            </main>
        );
    }

    if (!session) {
        return (
            <CreateLoginForm
                onAuthenticated={(next) => {
                    void applySession(next);
                }}
            />
        );
    }

    return (
        <>
            {workspaceError ? (
                <div className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-2xl">
                    <Alert type="warning" showIcon closable message={workspaceError} onClose={() => setWorkspaceError("")} />
                </div>
            ) : null}
            {children}
        </>
    );
}

