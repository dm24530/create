export const LOCAL_IMAGE_PASSTHROUGH_HEADER = "X-Create-Image-Passthrough";
export const LOCAL_IMAGE_PASSTHROUGH_VALUE = "local";

export function isLocalImagePassthrough() {
    if (typeof window === "undefined") return false;
    const bridge = (window as Window & { createDesktop?: { isDesktop?: boolean } }).createDesktop;
    return bridge?.isDesktop === true;
}

export function localImagePassthroughHeaders(): Record<string, string> {
    return isLocalImagePassthrough() ? { [LOCAL_IMAGE_PASSTHROUGH_HEADER]: LOCAL_IMAGE_PASSTHROUGH_VALUE } : {};
}
