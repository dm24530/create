import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { ManagedRouteBridge } from "@/components/layout/managed-route-bridge";
import { PersistentWorkbenchOutlet } from "@/components/layout/persistent-workbench-outlet";
import UserLayout from "@/layouts/user-layout";
import { isManagedMode } from "@/lib/managed-mode";
import { isCreateProductMode } from "@/lib/create-product";
import RouteErrorPage from "@/pages/route-error";

const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const ProductDetailPage = lazy(() => import("@/pages/product-detail"));
const HomePage = lazy(() => import("@/pages/home"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));

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
                <PersistentWorkbenchOutlet />
            </UserLayout>
        ),
        children: [
            isCreateProductMode()
                ? { path: "/", element: <Navigate to="/image" replace /> }
                : { path: "/", element: <HomePage /> },
            { path: "/image" },
            { path: "/video" },
            { path: "/product-detail", element: <ProductDetailPage /> },
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
