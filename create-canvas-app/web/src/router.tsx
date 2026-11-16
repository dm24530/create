import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { ManagedRouteBridge } from "@/components/layout/managed-route-bridge";
import UserLayout from "@/layouts/user-layout";
import { isManagedMode } from "@/lib/managed-mode";
import { isCreateProductMode } from "@/lib/create-product";
import RouteErrorPage from "@/pages/route-error";

const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function RouteLoading() {
    return (
        <main className="flex h-dvh items-center justify-center bg-background text-foreground">
            <span className="size-5 animate-spin rounded-full border-2 border-stone-500/20 border-t-orange-400" />
        </main>
    );
}

function ConfigRoute() {
    return isManagedMode() || isCreateProductMode() ? <NotFound /> : <ConfigPage />;
}

export const router = createBrowserRouter([
    {
        errorElement: <RouteErrorPage />,
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <ManagedRouteBridge />
                <Suspense fallback={<RouteLoading />}>
                    <Outlet />
                </Suspense>
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigRoute /> },
        ],
    },
    {
        path: "*",
        errorElement: <RouteErrorPage />,
        element: (
            <Suspense fallback={<RouteLoading />}>
                <NotFound />
            </Suspense>
        ),
    },
], {
    basename: import.meta.env.BASE_URL,
});

