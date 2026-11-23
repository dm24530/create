import type { ProductBrief, StoryboardPage, UserDesignSkill } from "@/types/product-detail";

export function buildNoTextImagePrompt(page: StoryboardPage, brief: ProductBrief, skill: UserDesignSkill): string {
    const colors = [...brief.colorPreference, ...skill.brand.colors].filter(Boolean).join("、") || "未预设，按商品图和参考图提取";
    const styles = [...brief.visualStyle, ...skill.brand.visualTone].filter(Boolean).join("、") || "未预设，按商品图和参考图提取";
    const visualDirection = sanitizeVisualPrompt(page);
    return [
        "生成电商商品详情页的无文字视觉底图",
        `商品名称：${brief.productName}`,
        `商品类目：${brief.category}`,
        `页面角色：${page.role}`,
        "保持商品外观一致，商品轮廓、比例、颜色、材质、Logo 和结构必须与用户商品图一致",
        "不得虚构商品未展示的背面、内部结构、附件或包装",
        `视觉风格：${styles}`,
        `主色与辅助色：${colors}`,
        "有商品图或参考图时，配色、光线、背景、材质氛围和视觉风格必须以参考图为主要依据；没有明确依据时保持中性，不预设品牌色板",
        "只生成一张连续的商业摄影画面，不要拼贴、多宫格、分屏、画中画、海报模板、圆角卡片或版式框；版式由应用后续另行渲染",
        "参考图只用于提取配色、光线、材质和氛围，不要复刻参考图的排版结构或图片组合方式",
        "采用干净的商业摄影构图，为后续文案排版留出安全区",
        "只使用产品、人物、场景、光线、材质和构图表达画面含义，不要制作海报排版",
        "商品自身已有的 Logo 和品牌标记必须保持原样；除商品本体已有标识外，不得新增任何文字、数字、字母、伪文字、标题、副标题、卖点、按钮、价格、标签、徽章、水印、认证标识或 UI 元素",
        `补充画面要求：${visualDirection}`,
    ].join("。\n");
}

export function buildNoTextNegativePrompt(page: StoryboardPage): string[] {
    return [...new Set([
        ...page.negativePrompt,
        "新增文字",
        "新增数字",
        "新增字母",
        "标题文字",
        "副标题",
        "卖点文字",
        "按钮文字",
        "价格",
        "标签",
        "页码",
        "编号",
        "海报排版",
        "拼贴",
        "多宫格",
        "分屏",
        "画中画",
        "海报模板",
        "版式框",
        "圆角卡片",
        "伪文字",
        "乱码",
        "水印",
        "Logo 变形",
        "产品结构变化",
        "错误比例",
        "多余配件",
    ])];
}

function sanitizeVisualPrompt(page: StoryboardPage) {
    const title = page.title.trim();
    const message = page.message.trim();
    return page.visualPrompt
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^(?:第\s*\d+\s*页｜|本页主题\s*[:：]|本页内容\s*[:：])/i.test(line))
        .join("。")
        .replaceAll(title, "")
        .replaceAll(message, "")
        .replace(/[。；，,]{2,}/g, "。")
        .replace(/^。+|。+$/g, "")
        .trim();
}