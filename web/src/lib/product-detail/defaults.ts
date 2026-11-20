import { nanoid } from "nanoid";

import type {
    ProductBrief,
    ProductDetailPlatform,
    ProductDetailPlatformProfile,
    ProductDetailWorkspace,
    ProductPageRole,
    UserDesignSkill,
} from "@/types/product-detail";

export const PRODUCT_DETAIL_WORKSPACE_VERSION = 1;

export const PRODUCT_DETAIL_PLATFORM_PROFILES: Record<ProductDetailPlatform, ProductDetailPlatformProfile> = {
    taobao: {
        id: "taobao",
        label: "淘宝/天猫",
        width: 750,
        format: "jpeg",
        maxFileSizeBytes: 3 * 1024 * 1024,
        maxSliceHeight: 2000,
        note: "上传前请以商家后台当前规则复核图片高度和体积。",
    },
    tmall: {
        id: "tmall",
        label: "天猫",
        width: 750,
        format: "jpeg",
        maxFileSizeBytes: 3 * 1024 * 1024,
        maxSliceHeight: 2000,
        note: "上传前请以商家后台当前规则复核图片高度和体积。",
    },
    jd: {
        id: "jd",
        label: "京东",
        width: 750,
        format: "jpeg",
        maxFileSizeBytes: 3 * 1024 * 1024,
        maxSliceHeight: 2000,
        note: "上传前请以商家后台当前规则复核图片高度和体积。",
    },
    pdd: {
        id: "pdd",
        label: "拼多多",
        width: 750,
        format: "jpeg",
        maxFileSizeBytes: 2 * 1024 * 1024,
        maxSliceHeight: 2000,
        note: "上传前请以商家后台当前规则复核图片高度和体积。",
    },
};

export const PRODUCT_PAGE_ROLES: ProductPageRole[] = [
    "hero",
    "pain-point",
    "core-benefit",
    "feature-detail",
    "scenario",
    "how-to-use",
    "specification",
    "trust",
    "closing",
];

export function createEmptyBrief(platform: ProductDetailPlatform): ProductBrief {
    return {
        productName: "",
        category: "",
        description: "",
        sellingPoints: [],
        targetAudience: [],
        scenarios: [],
        platform,
        visualStyle: [],
        colorPreference: [],
        copyTone: [],
        forbiddenContent: [],
        referenceAssetIds: [],
        productAssetIds: [],
        requiredModules: ["hero", "core-benefit", "feature-detail", "scenario", "specification", "closing"],
        assumptions: [],
        revision: 0,
    };
}

export function createEmptyWorkspace(): ProductDetailWorkspace {
    return {
        version: PRODUCT_DETAIL_WORKSPACE_VERSION,
        projects: [],
        skills: [],
        updatedAt: Date.now(),
    };
}

export function createEmptySkill(userId: number): UserDesignSkill {
    const now = Date.now();
    return {
        id: nanoid(),
        userId,
        name: "我的详情页风格",
        description: "从已完成项目沉淀的本地设计偏好。",
        enabled: true,
        scope: "global",
        brand: { colors: [], fonts: [], visualTone: [] },
        copy: { tone: [], preferredPhrases: [], forbiddenPhrases: [], density: "balanced" },
        layout: { preferredTemplates: [] },
        pagePatterns: [],
        categoryKnowledge: [],
        complianceRules: [],
        referenceAssetIds: [],
        sourceProjectIds: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
    };
}
