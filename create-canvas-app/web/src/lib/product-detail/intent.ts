export type ProductDetailGenerationIntent = "storyboard" | "images" | null;

export function classifyProductDetailGenerationIntent(text: string): ProductDetailGenerationIntent {
    const value = text.replace(/\s+/g, "").toLowerCase();
    if (!value) return null;
    if (
        /(开始实现|开始制作|立即实现|立即生成|直接生成|开始出图|全部生成|生成全部|生成所有|所有(页面|图片|底图)|全部(页面|图片|底图|屏)|按.*分镜.*生成|分镜.*生成.*(图片|底图|屏)|生成.*(6屏|六屏|全部|所有))/.test(value)
    ) return "images";
    if (/(生成分镜|规划分镜|做分镜|出分镜|页面分镜|分镜规划)/.test(value)) return "storyboard";
    return null;
}