export function isGeminiImageModel(name: string) {
    const value = name.trim().toLowerCase();
    if (value.includes("banana")) return true;
    return value.includes("gemini") && value.includes("image");
}
