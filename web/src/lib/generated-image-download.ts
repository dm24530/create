import { getImageBlob } from "@/services/image-storage";

export type DownloadableImage = {
    dataUrl: string;
    storageKey?: string;
    mimeType?: string;
};

type ImageDownloadDependencies = {
    getStoredImage: (storageKey: string) => Promise<Blob | null>;
    fetchImage: (url: string) => Promise<Blob>;
};

const defaultDependencies: ImageDownloadDependencies = {
    getStoredImage: (storageKey) => getImageBlob(storageKey),
    fetchImage: async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error("IMAGE_DOWNLOAD_FETCH_FAILED");
        return response.blob();
    },
};

export async function resolveGeneratedImageBlob(image: DownloadableImage, dependencies: ImageDownloadDependencies = defaultDependencies): Promise<Blob> {
    if (image.storageKey) {
        const stored = await dependencies.getStoredImage(image.storageKey).catch(() => null);
        if (stored?.size) return stored;
    }
    if (image.dataUrl) {
        const fetched = await dependencies.fetchImage(image.dataUrl);
        if (fetched.size) return fetched;
    }
    throw new Error("IMAGE_DOWNLOAD_SOURCE_MISSING");
}