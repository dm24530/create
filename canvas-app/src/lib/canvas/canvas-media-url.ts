export function safeCanvasMediaSource(raw?: string | null): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower.startsWith("data:image/") || lower.startsWith("data:video/") || lower.startsWith("data:audio/")) {
    return value;
  }
  if (lower.startsWith("blob:")) return value;
  if (value.startsWith("/")) return value.startsWith("//") ? "" : value;
  if (typeof window === "undefined") return "";
  try {
    return new URL(value, window.location.origin).origin === window.location.origin ? value : "";
  } catch {
    return "";
  }
}

export function cloudCanvasMediaSource(raw?: string | null): string {
  const value = safeCanvasMediaSource(raw);
  if (!value || value.toLowerCase().startsWith("blob:")) return "";
  return value;
}

const mediaKeys = new Set([
  "content",
  "url",
  "cloudURL",
  "cloudPreviewURL",
  "previewUrl",
  "coverUrl",
  "posterUrl",
  "thumbnailUrl",
  "thumbUrl",
]);

export function sanitizeCanvasMediaValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return mediaKeys.has(key) ? safeCanvasMediaSource(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCanvasMediaValue(item, key));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = sanitizeCanvasMediaValue(child, childKey);
    }
    return result;
  }
  return value;
}
