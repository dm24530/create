import type { ReferenceImage } from "@/types/image";

import i18n from "@/i18n";

export function imageReferenceLabel(index: number) {
    return i18n.t("imageReferences.label", { index: index + 1 });
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((reference, index) => {
        const label = imageReferenceLabel(index);
        const title = reference.name.replace(/\.(png|jpe?g|webp|gif|avif)$/i, "").trim();
        return title && title !== label ? `${label}（${title}）` : label;
    });
    return i18n.t("imageReferences.promptPrefix", { labels: labels.join(i18n.t("imageReferences.separator")), prompt: text });
}
