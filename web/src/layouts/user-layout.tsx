import { lazy, Suspense, type ReactNode } from "react";

import { isManagedMode } from "@/lib/managed-mode";

const AppTopNav = lazy(() => import("@/components/layout/app-top-nav").then((module) => ({
    default: module.AppTopNav,
})));

export default function UserLayout({ children }: { children: ReactNode }) {
    if (isManagedMode()) {
        return (
            <div className="flex h-dvh overflow-hidden bg-background text-foreground">
                <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
            </div>
        );
    }

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <Suspense fallback={<div className="h-14 shrink-0 border-b border-stone-200 dark:border-stone-800" />}>
                    <AppTopNav />
                </Suspense>
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
        </div>
    );
}
