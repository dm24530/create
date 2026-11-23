import type { ProductPageRole, UserDesignSkill } from "@/types/product-detail";

type StructuralSkillInput = {
    id: string;
    name: string;
    description: string;
    category: string;
    revision?: number;
    pagePatterns: Array<{ role: ProductPageRole; guidance: string }>;
    categoryKnowledge: string[];
    complianceRules: string[];
    forbiddenPhrases: string[];
};

export const BUILTIN_HOME_TEXTILE_SKILL_ID = "builtin-home-textile-v1";

function structuralSkill(input: StructuralSkillInput): UserDesignSkill {
    return {
        id: input.id,
        userId: 0,
        name: input.name,
        description: input.description,
        enabled: true,
        scope: "category",
        category: input.category,
        brand: { colors: [], fonts: [], visualTone: [] },
        copy: { tone: [], preferredPhrases: [], forbiddenPhrases: input.forbiddenPhrases, density: "balanced" },
        layout: { preferredTemplates: [] },
        pagePatterns: input.pagePatterns,
        categoryKnowledge: input.categoryKnowledge,
        complianceRules: input.complianceRules,
        referenceAssetIds: [],
        sourceProjectIds: [],
        revision: input.revision || 1,
        createdAt: 0,
        updatedAt: 0,
    };
}

export const BUILTIN_HOME_TEXTILE_SKILL = structuralSkill({
    id: BUILTIN_HOME_TEXTILE_SKILL_ID,
    name: "家纺床品详情页",
    description: "结构型家纺详情页 Skill：只提供家纺类目的信息结构、页面职责和合规约束。配色、字体、材质氛围与视觉风格必须从用户商品图、参考图和 Brief 中提取。",
    category: "家纺",
    revision: 2,
    pagePatterns: [
        { role: "hero", guidance: "展示完整卧室或卧室局部铺陈，商品花型、颜色、垂坠和空间氛围必须来自用户商品图与参考图，不预设色调。" },
        { role: "pain-point", guidance: "用换季闷热、睡眠不适、床品起球或清洗麻烦等真实居住场景表达痛点，避免医疗功效和夸张对比。" },
        { role: "core-benefit", guidance: "把亲肤、透气、保暖、蓬松或吸湿等核心利益转化为面料微距、光线、空气感和结构细节；只使用用户确认的卖点。" },
        { role: "feature-detail", guidance: "根据商品实际结构展示织纹、密度、包边、拉链、走线、填充层、双面设计或花型对位，不虚构未提供的工艺。" },
        { role: "scenario", guidance: "使用主卧、次卧、儿童房、宿舍或酒店客房等真实空间，空间风格必须与用户参考图一致。" },
        { role: "how-to-use", guidance: "展示铺设、尺寸选择、换洗、收纳或护理步骤，画面简洁，不生成数字和说明文字。" },
        { role: "specification", guidance: "为尺寸、材质、支数/密度、克重、填充物、工艺、适用床型和洗护方式预留清晰参数区；参数只用用户已确认事实。" },
        { role: "trust", guidance: "使用可验证的质检、色牢度、工艺和包装细节；没有用户事实时不得虚构认证、奖项或功效。" },
        { role: "closing", guidance: "以参考图确定的卧室氛围收尾，突出花色选择和安心购买理由，不套用预设色板或品牌风格。" },
    ],
    categoryKnowledge: [
        "四件套通常包含被套、床单或床笠、枕套",
        "家纺内容重点是材质、触感、织造、填充、尺寸、色牢度和洗护",
        "床品画面应同时体现整体铺陈与面料微距",
        "多花色商品需要清楚展示配色和 SKU 选择",
        "没有商品图或参考图时，先询问或等待用户提供视觉依据",
    ],
    complianceRules: [
        "不得预设品牌色、字体、视觉调性或固定版式风格",
        "配色、光线、空间和材质氛围必须优先来自用户商品图与参考图",
        "不得编造检测报告、认证、奖项或销量",
        "不得使用治疗失眠等医疗功效表达",
        "抗菌、防螨、零甲醛等表述必须有用户提供的事实依据",
        "避免绝对化承诺，如永不掉色、绝对不起球",
    ],
    forbiddenPhrases: ["治疗失眠", "永久抗菌", "永不掉色", "绝对不起球", "国家级认证"],
});

const BUILTIN_BEAUTY_SKILL = structuralSkill({
    id: "builtin-beauty-care-v1",
    name: "美妆个护详情页",
    description: "结构型美妆个护详情页 Skill：聚焦产品质地、成分、使用方法、适用人群和合规证明，视觉风格必须以参考图为准。",
    category: "美妆个护",
    pagePatterns: [
        { role: "hero", guidance: "展示真实产品包装、质地和使用场景，产品外观与配色来自参考图，不预设色板。" },
        { role: "pain-point", guidance: "用用户真实关注的肤感、清洁、便携或妆效问题组织画面，不夸大功效。" },
        { role: "core-benefit", guidance: "用质地、泡沫、延展、光泽或使用动作表达核心卖点，只使用已确认成分和功效。" },
        { role: "feature-detail", guidance: "展示包装、泵头、滴管、膏体质地、纹理或使用细节，不虚构成分和实验。" },
        { role: "scenario", guidance: "展示晨间、夜间、通勤、旅行或健身等真实使用场景，环境风格来自参考图。" },
        { role: "how-to-use", guidance: "展示使用顺序、取用量和护理步骤，画面中不生成说明文字。" },
        { role: "specification", guidance: "为规格、适用肤质、成分、使用方式、保质期和注意事项预留参数区。" },
        { role: "trust", guidance: "只展示用户提供的检测、备案、包装或使用证据，不虚构医疗或实验室结论。" },
        { role: "closing", guidance: "以参考图确定的日常护理氛围收尾，不添加未确认的功效承诺。" },
    ],
    categoryKnowledge: ["美妆个护重点是产品真值、质地、使用方式、适用人群和合规表达", "成分和功效必须有用户事实依据", "包装文字不等于商品功效"],
    complianceRules: ["不得使用医疗级、治疗、根治、永久见效等表达", "不得编造检测、备案、成分浓度或用户评价", "不得预设视觉风格"],
    forbiddenPhrases: ["医疗级", "根治", "永久见效", "立刻变白", "国家级认证"],
});

const BUILTIN_FOOD_SKILL = structuralSkill({
    id: "builtin-food-beverage-v1",
    name: "食品饮料详情页",
    description: "结构型食品饮料详情页 Skill：突出食欲、原料、口感、场景、规格和食品安全信息，不预设色调和版式。",
    category: "食品饮料",
    pagePatterns: [
        { role: "hero", guidance: "以真实包装和食物本体为核心，突出新鲜、口感或场景，配色与光线来自参考图。" },
        { role: "pain-point", guidance: "用早餐、加班、出行、送礼或储存等真实场景表达需求，不虚构健康功效。" },
        { role: "core-benefit", guidance: "用原料、切面、质地、冲泡或食用画面表达核心卖点，不生成文字。" },
        { role: "feature-detail", guidance: "展示包装、原料纹理、配料形态、封口或便携结构，商品外观必须与参考图一致。" },
        { role: "scenario", guidance: "展示家庭、办公室、户外、聚会或送礼等真实使用场景。" },
        { role: "how-to-use", guidance: "展示开封、冲泡、加热或储存步骤，不生成数字和说明文字。" },
        { role: "specification", guidance: "为净含量、配料、保质期、储存方式、过敏原和食用方式预留参数区。" },
        { role: "trust", guidance: "只展示用户提供的生产、检测、产地或包装证据，不虚构食品安全结论。" },
        { role: "closing", guidance: "以参考图确定的食欲或送礼氛围收尾，不添加未确认健康承诺。" },
    ],
    categoryKnowledge: ["食品饮料重点是真实包装、原料、口感、场景、净含量和储存方式", "配料、保质期和过敏原必须使用确认信息"],
    complianceRules: ["不得使用治疗、预防疾病、降血糖等医疗功效", "不得编造产地、检测、有机或零添加认证", "不得预设颜色和视觉风格"],
    forbiddenPhrases: ["治疗疾病", "降血糖", "永久保鲜", "绝对零添加", "国家级认证"],
});

const BUILTIN_DIGITAL_SKILL = structuralSkill({
    id: "builtin-digital-3c-v1",
    name: "数码3C详情页",
    description: "结构型数码3C详情页 Skill：强调产品真值、接口结构、使用场景、性能和参数，视觉必须依据用户商品图。",
    category: "数码3C",
    pagePatterns: [
        { role: "hero", guidance: "完整展示产品外观、屏幕、接口和配件，材质与光线来自参考图。" },
        { role: "pain-point", guidance: "用办公、通勤、续航、连接或携带等真实需求组织画面，不夸大性能。" },
        { role: "core-benefit", guidance: "把性能、效率、便携或连接能力转化为可感知的产品细节和使用动作。" },
        { role: "feature-detail", guidance: "展示接口、按键、散热、屏幕、材质和结构，不虚构未展示的内部结构。" },
        { role: "scenario", guidance: "展示桌面、通勤、差旅、游戏或家庭等真实使用环境。" },
        { role: "how-to-use", guidance: "展示连接、安装、充电或操作步骤，画面中不生成数字和说明文字。" },
        { role: "specification", guidance: "为尺寸、重量、接口、续航、兼容性、包装和保修预留参数区。" },
        { role: "trust", guidance: "只使用用户提供的测试、认证和保修信息，不虚构跑分或实验。" },
        { role: "closing", guidance: "以产品使用后的生活场景收尾，不添加未确认性能承诺。" },
    ],
    categoryKnowledge: ["数码3C重点是产品真值、接口、尺寸、兼容性和真实参数", "不得补画参考图未展示的内部结构或配件"],
    complianceRules: ["不得编造性能跑分、认证、续航和保修", "不得使用绝对第一、永不故障等承诺", "不得预设科技风或品牌色"],
    forbiddenPhrases: ["性能第一", "永不故障", "绝对领先", "官方认证", "100% 安全"],
});

const BUILTIN_FASHION_SKILL = structuralSkill({
    id: "builtin-fashion-apparel-v1",
    name: "服饰鞋包详情页",
    description: "结构型服饰鞋包详情页 Skill：聚焦版型、面料、细节、尺码、搭配和真实穿着效果，不预设风格。",
    category: "服饰鞋包",
    pagePatterns: [
        { role: "hero", guidance: "展示完整版型、轮廓和穿着效果，服装颜色和搭配来自用户参考图。" },
        { role: "pain-point", guidance: "用尺码、舒适、收纳、通勤或场景搭配等真实顾虑组织画面。" },
        { role: "core-benefit", guidance: "通过面料垂坠、弹力、结构或使用动作表达核心卖点，不虚构材质。" },
        { role: "feature-detail", guidance: "展示缝线、拉链、里料、鞋底、五金和包型等真实细节。" },
        { role: "scenario", guidance: "展示通勤、休闲、约会、旅行等真实穿搭场景，风格以参考图为准。" },
        { role: "how-to-use", guidance: "展示尺码选择、穿脱、搭配或护理步骤，不生成数字和说明文字。" },
        { role: "specification", guidance: "为尺码、材质、版型、洗护和适用场景预留参数区。" },
        { role: "trust", guidance: "只展示用户提供的材质、工艺、质检和售后证据。" },
        { role: "closing", guidance: "以参考图确定的穿搭氛围收尾，不强制预设风格。" },
    ],
    categoryKnowledge: ["服饰鞋包重点是版型、面料、细节、尺码和真实穿着效果", "尺码必须使用用户确认数据"],
    complianceRules: ["不得编造面料成分、产地、奖项和检测", "不得使用永不掉色、绝对合身等承诺", "不得预设品牌风格"],
    forbiddenPhrases: ["永不掉色", "绝对合身", "国家级认证", "100% 不起球"],
});

const BUILTIN_HOME_DAILY_SKILL = structuralSkill({
    id: "builtin-home-daily-v1",
    name: "家居日用详情页",
    description: "结构型家居日用详情页 Skill：聚焦真实空间、功能、结构、材质、尺寸和清洁维护，不预设视觉风格。",
    category: "家居日用",
    pagePatterns: [
        { role: "hero", guidance: "在真实家居空间中展示完整商品和比例，空间风格来自参考图。" },
        { role: "pain-point", guidance: "用收纳、清洁、空间、耐用或使用不便等真实场景表达需求。" },
        { role: "core-benefit", guidance: "用使用动作、结构和材质细节表达商品功能，不夸大效果。" },
        { role: "feature-detail", guidance: "展示材质、接缝、结构、配件和清洁死角等真实细节。" },
        { role: "scenario", guidance: "展示厨房、客厅、卫生间、阳台或卧室等真实空间。" },
        { role: "how-to-use", guidance: "展示安装、使用、收纳或清洁步骤，不生成数字和说明文字。" },
        { role: "specification", guidance: "为尺寸、材质、容量、承重、安装和清洁方式预留参数区。" },
        { role: "trust", guidance: "只使用用户提供的耐用、检测和售后信息。" },
        { role: "closing", guidance: "以参考图确定的整洁居家氛围收尾。" },
    ],
    categoryKnowledge: ["家居日用重点是空间比例、结构、材质、尺寸和清洁维护", "不得虚构承重、抗菌和耐用数据"],
    complianceRules: ["不得编造检测、耐用年限和环保认证", "不得使用永久防污、绝对承重等承诺", "不得预设家居风格"],
    forbiddenPhrases: ["永久防污", "绝对承重", "国家级认证", "100% 安全"],
});

const BUILTIN_MATERNAL_SKILL = structuralSkill({
    id: "builtin-maternal-baby-v1",
    name: "母婴用品详情页",
    description: "结构型母婴用品详情页 Skill：强调年龄适用、材质安全、使用方式、清洁和合规表达，视觉以用户参考图为准。",
    category: "母婴用品",
    pagePatterns: [
        { role: "hero", guidance: "展示真实亲子使用场景和完整商品，环境与配色来自参考图。" },
        { role: "pain-point", guidance: "用喂养、睡眠、出行、清洁或收纳等真实育儿场景表达需求。" },
        { role: "core-benefit", guidance: "用材质、结构和使用动作表达舒适与便利，不添加未确认安全结论。" },
        { role: "feature-detail", guidance: "展示面料、接缝、扣件、支撑结构、清洁方式等真实细节。" },
        { role: "scenario", guidance: "展示家庭、卧室、户外、出行等真实亲子场景。" },
        { role: "how-to-use", guidance: "展示安装、调节、使用和清洁步骤，不生成数字和说明文字。" },
        { role: "specification", guidance: "为适用年龄、尺寸、材质、清洁和注意事项预留参数区。" },
        { role: "trust", guidance: "只使用用户提供的检测、认证和售后信息，不虚构安全承诺。" },
        { role: "closing", guidance: "以参考图确定的安心亲子氛围收尾。" },
    ],
    categoryKnowledge: ["母婴用品重点是适用年龄、材质、结构、清洁和监护说明", "安全相关表述必须有用户事实依据"],
    complianceRules: ["不得编造安全认证、医疗功效和检测报告", "不得使用绝对安全、治疗等承诺", "不得预设颜色和视觉风格"],
    forbiddenPhrases: ["绝对安全", "治疗", "国家级认证", "永久抗菌"],
});

export const BUILTIN_DESIGN_SKILLS: UserDesignSkill[] = [
    BUILTIN_HOME_TEXTILE_SKILL,
    BUILTIN_BEAUTY_SKILL,
    BUILTIN_FOOD_SKILL,
    BUILTIN_DIGITAL_SKILL,
    BUILTIN_FASHION_SKILL,
    BUILTIN_HOME_DAILY_SKILL,
    BUILTIN_MATERNAL_SKILL,
];

export function ensureBuiltinSkills(skills: UserDesignSkill[], userId: number): UserDesignSkill[] {
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    const result = skills.map((skill) => {
        const template = BUILTIN_DESIGN_SKILLS.find((item) => item.id === skill.id);
        return template
            ? { ...template, userId, enabled: skill.enabled, createdAt: skill.createdAt || 0 }
            : skill;
    });
    for (const template of BUILTIN_DESIGN_SKILLS) {
        if (!byId.has(template.id)) result.unshift({ ...template, userId });
    }
    return result;
}