import type { AiConfig } from "@/stores/use-config-store";
import type { ProductDetailProject } from "@/types/product-detail";

export function resolveProductDetailTextModel(project: Pick<ProductDetailProject, "textModel">, config: AiConfig) {
    return project.textModel?.trim() || config.textModel || "";
}

export function resolveProductDetailImageModel(project: Pick<ProductDetailProject, "imageModel">, config: AiConfig) {
    return project.imageModel?.trim() || config.imageModel || "";
}
