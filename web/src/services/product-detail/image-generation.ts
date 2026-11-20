import { nanoid } from "nanoid";

import { buildNoTextImagePrompt, buildNoTextNegativePrompt } from "@/lib/product-detail/image-prompt";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductDetailAsset, ProductDetailProject, StoryboardPage, UserDesignSkill } from "@/types/product-detail";
import type { ReferenceImage } from "@/types/image";

export async function generateStoryboardImage(
    config: AiConfig,
    project: ProductDetailProject,
    page: StoryboardPage,
    skill: UserDesignSkill,
    signal?: AbortSignal,
): Promise<ProductDetailAsset> {
    const prompt = [
        buildNoTextImagePrompt(page, project.brief, skill),
        `禁止出现：${buildNoTextNegativePrompt(page).join("、")}`,
    ].join("\n");
    const references = project.assets
        .filter((asset) => asset.kind === "product" && (project.brief.productAssetIds.includes(asset.id) || project.brief.productAssetIds.length === 0))
        .map((asset): ReferenceImage => ({
            id: asset.id,
            name: asset.name,
            type: asset.mimeType,
            dataUrl: asset.url || "",
            storageKey: asset.storageKey,
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes,
        }));
    const imageConfig: AiConfig = { ...config, model: config.imageModel || config.model, count: "1" };
    const results = references.length
        ? await requestEdit(imageConfig, prompt, references, { signal })
        : await requestGeneration(imageConfig, prompt, { signal });
    const first = results.find((image) => image.dataUrl && !image.previewOnly);
    if (!first) throw new Error("图片接口没有返回可用的完整原图");
    const uploaded = await uploadImage(first.dataUrl);
    return {
        id: nanoid(),
        name: `${project.name}-${page.order}.${uploaded.mimeType.includes("jpeg") ? "jpg" : "png"}`,
        kind: "generated",
        storageKey: uploaded.storageKey,
        url: uploaded.url,
        mimeType: uploaded.mimeType || "image/png",
        width: uploaded.width,
        height: uploaded.height,
        bytes: uploaded.bytes,
        createdAt: Date.now(),
    };
}
