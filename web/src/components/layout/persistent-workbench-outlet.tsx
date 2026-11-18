import { lazy, Suspense, useLayoutEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";

const ImagePage = lazy(() => import("@/pages/image"));
const VideoPage = lazy(() => import("@/pages/video"));

function WorkbenchLoading() {
    return (
        <main className="flex h-full min-h-0 items-center justify-center bg-background text-foreground">
            <span className="size-5 animate-spin rounded-full border-2 border-stone-500/20 border-t-orange-400" />
        </main>
    );
}

export function PersistentWorkbenchOutlet() {
    const { pathname } = useLocation();
    const imageActive = pathname === "/image" || pathname.startsWith("/image/");
    const videoActive = pathname === "/video" || pathname.startsWith("/video/");
    const [mounted, setMounted] = useState({ image: imageActive, video: videoActive });

    useLayoutEffect(() => {
        setMounted((current) => {
            const next = {
                image: current.image || imageActive,
                video: current.video || videoActive,
            };
            return next.image === current.image && next.video === current.video ? current : next;
        });
    }, [imageActive, videoActive]);

    const keepImageMounted = mounted.image || imageActive;
    const keepVideoMounted = mounted.video || videoActive;
    const workbenchActive = imageActive || videoActive;

    return (
        <>
            {keepImageMounted ? (
                <div
                    className={cn("h-full min-h-0 overflow-hidden", !imageActive && "hidden")}
                    aria-hidden={!imageActive}
                    data-workbench-slot="image"
                >
                    <Suspense fallback={<WorkbenchLoading />}>
                        <ImagePage />
                    </Suspense>
                </div>
            ) : null}
            {keepVideoMounted ? (
                <div
                    className={cn("h-full min-h-0 overflow-hidden", !videoActive && "hidden")}
                    aria-hidden={!videoActive}
                    data-workbench-slot="video"
                >
                    <Suspense fallback={<WorkbenchLoading />}>
                        <VideoPage />
                    </Suspense>
                </div>
            ) : null}
            {!workbenchActive ? (
                <Suspense fallback={<WorkbenchLoading />}>
                    <Outlet />
                </Suspense>
            ) : null}
        </>
    );
}