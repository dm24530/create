import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

type PanelResizeHandleProps = {
    className?: string;
    getWidth: () => number;
    minWidth: number;
    maxWidth: number | (() => number);
    onWidthChange: (width: number) => void;
    label: string;
};

export function useStoredPanelWidth(key: string, initialWidth: number) {
    const [width, setWidth] = useState(() => {
        try {
            const stored = Number(localStorage.getItem(key));
            return Number.isFinite(stored) && stored > 0 ? stored : initialWidth;
        } catch {
            return initialWidth;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, String(Math.round(width)));
        } catch {
            // Restoring panel width is best-effort in hardened browser contexts.
        }
    }, [key, width]);

    return [width, setWidth] as const;
}

export function PanelResizeHandle({ className, getWidth, minWidth, maxWidth, onWidthChange, label }: PanelResizeHandleProps) {
    const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            className={cn("group relative z-20 cursor-col-resize touch-none select-none items-stretch justify-center", className)}
            onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: getWidth() };
                setDragging(true);
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const limit = typeof maxWidth === "function" ? maxWidth() : maxWidth;
                const next = Math.max(minWidth, Math.min(limit, drag.startWidth + event.clientX - drag.startX));
                onWidthChange(next);
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
        >
            <span className={cn("my-2 w-px rounded-full bg-stone-300 transition-colors dark:bg-stone-700", dragging ? "bg-stone-100 dark:bg-stone-300" : "group-hover:bg-stone-400 dark:group-hover:bg-stone-500")} />
            <span className={cn("absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity", dragging ? "bg-stone-200 opacity-100 dark:bg-stone-300" : "opacity-0 group-hover:opacity-70 dark:bg-stone-500")} />
        </div>
    );
}
