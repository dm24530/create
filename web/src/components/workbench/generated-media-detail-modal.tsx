import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { Copy, Download, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatBytes, formatDuration } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";

export type GeneratedMediaDetailData = {
    kind: "image" | "video";
    src: string;
    prompt?: string;
    model?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    prepareDurationMs?: number;
    generationDurationMs?: number;
    downloadDurationMs?: number;
    bytes?: number;
};

type GeneratedMediaDetailModalProps = {
    data: GeneratedMediaDetailData | null;
    onClose: () => void;
    onDownload?: (data: GeneratedMediaDetailData) => void | Promise<void>;
};

const MIN_IMAGE_ZOOM = 1;
const MAX_IMAGE_ZOOM = 8;
const ZOOM_STEP = 1.25;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function ImageDetailStage({ src }: { src: string }) {
    const { t } = useTranslation();
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setDragging(false);
        dragRef.current = null;
    }, [src]);

    const constrainOffset = (nextZoom: number, x: number, y: number) => {
        const element = stageRef.current;
        if (!element || nextZoom <= 1) return { x: 0, y: 0 };
        const maxX = (element.clientWidth * (nextZoom - 1)) / 2;
        const maxY = (element.clientHeight * (nextZoom - 1)) / 2;
        return {
            x: clamp(x, -maxX, maxX),
            y: clamp(y, -maxY, maxY),
        };
    };

    const zoomAround = (nextZoom: number, pointerX = 0, pointerY = 0) => {
        const normalizedZoom = clamp(nextZoom, MIN_IMAGE_ZOOM, MAX_IMAGE_ZOOM);
        if (Math.abs(normalizedZoom - zoom) < 0.001) return;
        const ratio = normalizedZoom / zoom;
        const nextOffset = constrainOffset(
            normalizedZoom,
            pointerX - (pointerX - offset.x) * ratio,
            pointerY - (pointerY - offset.y) * ratio,
        );
        setZoom(normalizedZoom);
        setOffset(nextOffset);
    };

    useEffect(() => {
        const element = stageRef.current;
        if (!element) return;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = element.getBoundingClientRect();
            const pointerX = event.clientX - rect.left - rect.width / 2;
            const pointerY = event.clientY - rect.top - rect.height / 2;
            const factor = Math.exp(-event.deltaY * 0.0015);
            zoomAround(zoom * factor, pointerX, pointerY);
        };
        element.addEventListener("wheel", handleWheel, { passive: false });
        return () => element.removeEventListener("wheel", handleWheel);
    }, [offset.x, offset.y, zoom]);

    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (zoom <= 1 || event.button !== 0) return;
        event.preventDefault();
        dragRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
    };

    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        setOffset(constrainOffset(
            zoom,
            drag.offsetX + event.clientX - drag.pointerX,
            drag.offsetY + event.clientY - drag.pointerY,
        ));
    };

    const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const resetZoom = () => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    return (
        <div
            ref={stageRef}
            className={`relative h-[70vh] max-h-[720px] min-h-[320px] w-full touch-none overflow-hidden rounded-xl bg-stone-950 ${zoom > 1 ? dragging ? "cursor-grabbing" : "cursor-grab" : "cursor-zoom-in"}`}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onDoubleClick={() => zoom > 1 ? resetZoom() : zoomAround(2)}
        >
            <img
                src={src}
                alt={t("workbench.details")}
                draggable={false}
                className="pointer-events-none size-full select-none object-contain"
                style={{
                    transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: dragging ? "none" : "transform 80ms ease-out",
                }}
            />
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-white/10 bg-black/65 p-1 text-white shadow-lg backdrop-blur">
                <button type="button" className="flex size-7 items-center justify-center rounded-md transition hover:bg-white/15 disabled:opacity-35" title={t("workbench.zoomOut")} aria-label={t("workbench.zoomOut")} disabled={zoom <= MIN_IMAGE_ZOOM} onClick={() => zoomAround(zoom / ZOOM_STEP)}>
                    <Minus className="size-3.5" />
                </button>
                <span className="min-w-11 text-center text-[11px] tabular-nums text-white/80">{Math.round(zoom * 100)}%</span>
                <button type="button" className="flex size-7 items-center justify-center rounded-md transition hover:bg-white/15 disabled:opacity-35" title={t("workbench.zoomIn")} aria-label={t("workbench.zoomIn")} disabled={zoom >= MAX_IMAGE_ZOOM} onClick={() => zoomAround(zoom * ZOOM_STEP)}>
                    <Plus className="size-3.5" />
                </button>
                <button type="button" className="flex size-7 items-center justify-center rounded-md transition hover:bg-white/15 disabled:opacity-35" title={t("workbench.resetZoom")} aria-label={t("workbench.resetZoom")} disabled={zoom <= MIN_IMAGE_ZOOM && offset.x === 0 && offset.y === 0} onClick={resetZoom}>
                    <RotateCcw className="size-3.5" />
                </button>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/70 backdrop-blur">
                {t("workbench.zoomHint")}
            </div>
        </div>
    );
}

export function GeneratedMediaDetailModal({ data, onClose, onDownload }: GeneratedMediaDetailModalProps) {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const prompt = data?.prompt?.trim() || "";
    const hasDimensions = Boolean(data?.width && data?.height);

    useEffect(() => {
        if (!data) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [data, onClose]);

    if (!data || typeof document === "undefined") return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-label={t("workbench.details")}
                className="max-h-[92vh] w-full max-w-[1080px] overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-950"
            >
                <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-stone-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
                    <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">{t("workbench.details")}</h2>
                    <button
                        type="button"
                        className="flex size-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        aria-label={t("common.cancel")}
                        onClick={onClose}
                    >
                        <X className="size-5" />
                    </button>
                </header>

                <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
                    <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl bg-stone-950">
                        {data.kind === "image" ? (
                            <ImageDetailStage src={data.src} />
                        ) : (
                            <video src={data.src} controls className="max-h-[70vh] w-full bg-black object-contain" />
                        )}
                    </div>

                    <section className="flex min-w-0 flex-col gap-4">
                        <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t("workbench.prompt")}</h3>
                                <Button size="small" icon={<Copy className="size-3.5" />} disabled={!prompt} onClick={() => copyText(prompt, t("common.promptCopied"))}>
                                    {t("common.copy")}
                                </Button>
                            </div>
                            <div className="max-h-56 min-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-6 text-stone-700 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300">
                                {prompt || t("workbench.noPrompt")}
                            </div>
                        </div>

                        <dl className="grid grid-cols-2 gap-3 text-sm">
                            {data.model ? (
                                <div className="col-span-2 min-w-0">
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.model")}</dt>
                                    <dd className="mt-1 truncate font-medium text-stone-900 dark:text-stone-100">{data.model}</dd>
                                </div>
                            ) : null}
                            {hasDimensions ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.dimensions")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{data.width}x{data.height}</dd>
                                </div>
                            ) : null}
                            {data.bytes ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.fileSize")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatBytes(data.bytes)}</dd>
                                </div>
                            ) : null}
                            {data.prepareDurationMs ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.prepareDuration")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(data.prepareDurationMs)}</dd>
                                </div>
                            ) : null}
                            {data.generationDurationMs ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.generationDuration")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(data.generationDurationMs)}</dd>
                                </div>
                            ) : null}
                            {data.downloadDurationMs && data.downloadDurationMs > 0 ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.downloadDuration")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(data.downloadDurationMs)}</dd>
                                </div>
                            ) : null}
                            {data.durationMs ? (
                                <div>
                                    <dt className="text-xs text-stone-500 dark:text-stone-400">{t("workbench.totalDuration")}</dt>
                                    <dd className="mt-1 font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(data.durationMs)}</dd>
                                </div>
                            ) : null}
                        </dl>

                        {onDownload ? (
                            <Button className="mt-auto" block icon={<Download className="size-4" />} onClick={() => void onDownload(data)}>
                                {t("common.download")}
                            </Button>
                        ) : null}
                    </section>
                </div>
            </section>
        </div>,
        document.body,
    );
}