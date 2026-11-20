import type { ProductBrief, StoryboardPage, UserDesignSkill } from "@/types/product-detail";

export function buildNoTextImagePrompt(page: StoryboardPage, brief: ProductBrief, skill: UserDesignSkill): string {
    const colors = [...brief.colorPreference, ...skill.brand.colors].filter(Boolean).join("、") || "自然中性色";
    const styles = [...brief.visualStyle, ...skill.brand.visualTone].filter(Boolean).join("、") || "干净商业摄影";
    return [
        "生成电商商品详情页的无文字视觉底图",
        `商品名称：${brief.productName}`,
        `商品类目：${brief.category}`,
        `页面角色：${page.role}`,
        `页面主题：${page.title}`,
        `页面信息：${page.message}`,
        "保持商品外观一致，商品轮廓、比例、颜色、材质、Logo 和结构必须与用户商品图一致",
        "不得虚构商品未展示的背面、内部结构、附件或包装",
        `视觉风格：${styles}`,
        `主色与辅助色：${colors}`,
        "采用竖版商业摄影构图，并为后续文案排版留出文案安全区",
        "不得生成任何文字、数字、字母、徽章、水印、认证标识或 UI 元素",
        `补充画面要求：${page.visualPrompt}`,
    ].join("。\n");
}

export function buildNoTextNegativePrompt(page: StoryboardPage): string[] {
    return [...new Set([
        ...page.negativePrompt,
        "文字",
        "数字",
        "水印",
        "Logo 变形",
        "产品结构变化",
        "错误比例",
        "多余配件",
    ])];
}
