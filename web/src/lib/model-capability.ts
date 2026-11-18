export type ModelCapability = "image" | "video" | "text" | "audio";

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo", "seedance"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney", "banana"];

/** Best-effort default capability for a freshly fetched model name. */
export function guessModelCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    const leaf = value.split("/").pop() || value;
    if (leaf === "muse-video" || leaf === "muse-cheap") return "video";
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}
