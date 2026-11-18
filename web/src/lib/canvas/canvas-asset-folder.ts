const INVALID_FOLDER_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const FALLBACK_TITLE = "未命名画布";
const MAX_TITLE_LENGTH = 60;

export function canvasAssetFolderName(id: string, title: string) {
    const shortId = String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || "canvas";
    const safeTitle = String(title || "")
        .normalize("NFKC")
        .replace(INVALID_FOLDER_CHARS, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[.\s-]+|[.\s-]+$/g, "")
        .slice(0, MAX_TITLE_LENGTH)
        .replace(/[.\s-]+$/g, "");
    return `${safeTitle || FALLBACK_TITLE}-${shortId}`;
}

export function canvasProjectAssetFolder(project: { id: string; title: string; assetFolder?: string }) {
    return project.assetFolder?.trim() || canvasAssetFolderName(project.id, project.title);
}
