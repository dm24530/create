import { useEffect, useState } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

const CHUNK_RELOAD_STORAGE_KEY = "infinite-canvas:last-chunk-reload";
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

function resolveErrorMessage(error: unknown) {
    if (isRouteErrorResponse(error)) {
        return `${error.status} ${error.statusText}`.trim();
    }
    if (error instanceof Error) return error.message;
    return String(error || "Unknown application error");
}

function isDynamicChunkError(message: string) {
    return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(message);
}

export default function RouteErrorPage() {
    const error = useRouteError();
    const message = resolveErrorMessage(error);
    const chunkError = isDynamicChunkError(message);
    const [reloading, setReloading] = useState(chunkError);

    useEffect(() => {
        if (!chunkError) return;
        try {
            const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) || 0);
            if (Date.now() - lastReload < CHUNK_RELOAD_COOLDOWN_MS) {
                setReloading(false);
                return;
            }
            sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
            window.location.reload();
        } catch {
            setReloading(false);
        }
    }, [chunkError]);

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
            <section className="w-full max-w-lg border-y border-stone-200 py-10 text-center dark:border-stone-800">
                <h1 className="text-lg font-semibold">
                    {reloading ? "画布已更新，正在重新加载..." : "画布加载失败"}
                </h1>
                <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
                    {reloading ? "正在获取最新版本，请稍候。" : "页面资源可能已更新，请刷新后继续。"}
                </p>
                {!reloading ? (
                    <button
                        type="button"
                        className="mt-6 rounded-lg bg-stone-950 px-4 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950"
                        onClick={() => window.location.reload()}
                    >
                        重新加载
                    </button>
                ) : null}
                {!chunkError ? <p className="mt-5 break-words text-xs text-stone-400">{message}</p> : null}
            </section>
        </main>
    );
}
