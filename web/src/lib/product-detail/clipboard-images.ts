type ClipboardItemLike = {
    kind?: string;
    type?: string;
    getAsFile?: () => File | null;
};

type ClipboardDataLike = {
    items?: ArrayLike<ClipboardItemLike>;
    files?: ArrayLike<File>;
};

export function imageFilesFromClipboardData(data: ClipboardDataLike | null | undefined): File[] {
    if (!data) return [];
    const files: File[] = [];
    const seen = new Set<string>();
    const add = (file: File | null | undefined) => {
        if (!file || !file.type.startsWith("image/")) return;
        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        if (seen.has(key)) return;
        seen.add(key);
        files.push(file);
    };

    if (data.items) {
        for (let index = 0; index < data.items.length; index += 1) {
            const item = data.items[index];
            if (item?.kind !== "file" || !item.type?.startsWith("image/")) continue;
            add(item.getAsFile?.());
        }
    }
    if (!files.length && data.files) {
        for (let index = 0; index < data.files.length; index += 1) add(data.files[index]);
    }
    return files;
}