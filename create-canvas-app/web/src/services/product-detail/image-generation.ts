import { nanoid } from "nanoid";

import { buildNoTextImagePrompt, buildNoTextNegativePrompt } from "@/lib/product-detail/image-prompt";
import { resolveProductDetailImageModel } from "@/lib/product-detail/models";
import { selectStoryboardReferenceAssets } from "@/lib/product-detail/reference-selection";
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
    let prompt = [
        buildNoTextImagePrompt(page, project.brief, skill),
        `禁止出现：${buildNoTextNegativePrompt(page).join("、")}`,
    ].join("\n");
    const referenceAssets = selectStoryboardReferenceAssets(project, page);
    const productReferenceCount = referenceAssets.filter((asset) => asset.kind === "product").length;
    if (referenceAssets.length) {
        prompt += productReferenceCount
            ? `\n参考图共 ${referenceAssets.length} 张，前 ${productReferenceCount} 张是商品真值图，其余是风格或构图参考；商品外观必须以商品真值图为准。`
            : `\n参考图共 ${referenceAssets.length} 张，仅用于风格、构图和场景参考，不得把参考图中的其他商品当成本商品。`;
    }
    const references = referenceAssets.map((asset): ReferenceImage => ({
        id: asset.id,
        name: asset.name,
        type: asset.mimeType,
        dataUrl: asset.url || "",
        storageKey: asset.storageKey,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
    }));
    const imageModel = resolveProductDetailImageModel(project, config);
    // Detail pages are portrait documents. Request a fixed 2:3 canvas so the
    // generated original is not later cropped from a landscape image.
    const imageConfig: AiConfig = { ...config, model: imageModel, imageModel, count: "1", size: "1024x1536" };
    const results = references.length
        ? await requestEdit(imageConfig, prompt, references, { signal })
        : await requestGeneration(imageConfig, prompt, { signal });
    const first = results.find((image) => Boolean(image.dataUrl));
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