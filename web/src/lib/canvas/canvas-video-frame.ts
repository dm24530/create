export type VideoFramePosition = "first" | "last" | "current";

export async function captureVideoFrame(source: string, position: VideoFramePosition, currentTime: number, maxWidth = 0, mimeType = "image/png", quality = 0.92) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
        const metadataLoaded = waitForVideo(video, "loadedmetadata");
        video.src = source;
        video.load();

        await metadataLoaded;
        const endTime = Math.max(0, video.duration - 0.001);
        const time = position === "first" ? 0 : position === "last" ? endTime : Math.min(currentTime, endTime);
        if (time) {
            const seeked = waitForVideo(video, "seeked");
            video.currentTime = time;
            await seeked;
        } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForVideo(video, "loadeddata");
        }

        const canvas = document.createElement("canvas");
        const scale = maxWidth > 0 && video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Failed to capture video frame"))), mimeType, quality));
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

function waitForVideo(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const onError = () => fail();
        const timer = window.setTimeout(() => fail("Video frame capture timed out"), 15_000);
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", onError);
            resolve();
        };
        const fail = (message = "Failed to read video frame") => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", onError);
            reject(new Error(message));
        };
        video.addEventListener(eventName, finish);
        video.addEventListener("error", onError);
    });
}
