const REASON_KEYS = ["message", "msg", "error", "detail", "reason", "failure_reason", "last_error"] as const;

export function generationFailureReason(value: unknown, fallback: string): string {
    return readReason(value, 0, new Set<object>()) || fallback;
}

function readReason(value: unknown, depth: number, seen: Set<object>): string {
    if (value === null || value === undefined || depth > 5) return "";
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) return "";
        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                const parsed = JSON.parse(text) as unknown;
                const reason = readReason(parsed, depth + 1, seen);
                if (reason) return reason;
            } catch {
                // Keep the original response text when it is not valid JSON.
            }
        }
        return text;
    }
    if (typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            const reason = readReason(item, depth + 1, seen);
            if (reason) return reason;
        }
        return "";
    }

    const record = value as Record<string, unknown>;
    for (const key of REASON_KEYS) {
        const reason = readReason(record[key], depth + 1, seen);
        if (reason) return reason;
    }
    return "";
}
