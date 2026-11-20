export type ProductDetailPlatform = "taobao" | "tmall" | "jd" | "pdd";

export type ProductFactSource = "user" | "visible" | "unconfirmed";

export type ProductFactItem = {
    id: string;
    text: string;
    label?: string;
    source: ProductFactSource;
};

export type ProductPageRole =
    | "hero"
    | "pain-point"
    | "core-benefit"
    | "feature-detail"
    | "scenario"
    | "how-to-use"
    | "specification"
    | "trust"
    | "closing";

export type ProductDetailProjectStatus =
    | "discovery"
    | "brief_ready"
    | "storyboard_draft"
    | "storyboard_confirmed"
    | "generating"
    | "review"
    | "completed"
    | "failed";

export type ProductBrief = {
    productName: string;
    category: string;
    description: string;
    sellingPoints: ProductFactItem[];
    targetAudience: string[];
    scenarios: string[];
    platform: ProductDetailPlatform;
    pricePosition?: "budget" | "mid" | "premium";
    visualStyle: string[];
    colorPreference: string[];
    copyTone: string[];
    forbiddenContent: string[];
    referenceAssetIds: string[];
    productAssetIds: string[];
    requiredModules: ProductPageRole[];
    assumptions: string[];
    revision: number;
};

export type ProductBriefPatch = Partial<Omit<ProductBrief, "revision">>;

export type ProductDetailAssetKind = "product" | "reference" | "generated" | "export";

export type ProductDetailAsset = {
    id: string;
    name: string;
    kind: ProductDetailAssetKind;
    storageKey?: string;
    url?: string;
    mimeType: string;
    width?: number;
    height?: number;
    bytes?: number;
    createdAt: number;
};

export type ProductCopyBlock = {
    id: string;
    kind: "eyebrow" | "title" | "body" | "spec" | "cta";
    text: string;
};

export type StoryboardPage = {
    id: string;
    order: number;
    role: ProductPageRole;
    title: string;
    message: string;
    copy: ProductCopyBlock[];
    visualPrompt: string;
    negativePrompt: string[];
    referenceAssetIds: string[];
    factRefs: string[];
    layoutTemplateId: string;
    status: "draft" | "generating" | "ready" | "failed";
    generatedAssetId?: string;
    error?: string;
};

export type Storyboard = {
    id: string;
    revision: number;
    status: "draft" | "confirmed";
    pages: StoryboardPage[];
};

export type ProductDetailConversationRole = "user" | "assistant";

export type ProductDetailAssistantTurn = {
    message: string;
    briefPatch?: ProductBriefPatch;
    question?: {
        field: keyof ProductBrief;
        prompt: string;
        options?: string[];
    };
    readyToPlan: boolean;
    assumptions: string[];
    risks: string[];
    skillCandidate?: UserDesignSkillPatch;
    storyboard?: Storyboard;
};

export type ProductDetailConversationMessage = {
    id: string;
    role: ProductDetailConversationRole;
    content: string;
    createdAt: number;
    turn?: ProductDetailAssistantTurn;
    error?: string;
};

export type UserDesignSkillPatch = Partial<Omit<UserDesignSkill, "id" | "userId" | "revision" | "createdAt" | "updatedAt" | "sourceProjectIds">> & {
    sourceProjectIds?: string[];
};

export type UserDesignSkill = {
    id: string;
    userId: number;
    name: string;
    description: string;
    enabled: boolean;
    scope: "global" | "category" | "platform";
    category?: string;
    platform?: ProductDetailPlatform;
    brand: {
        name?: string;
        colors: string[];
        fonts: string[];
        logoAssetId?: string;
        visualTone: string[];
    };
    copy: {
        tone: string[];
        preferredPhrases: string[];
        forbiddenPhrases: string[];
        density: "compact" | "balanced" | "rich";
    };
    layout: {
        preferredTemplates: string[];
        margins?: number;
        radius?: number;
        imageRatio?: string;
    };
    pagePatterns: Array<{
        role: ProductPageRole;
        guidance: string;
    }>;
    categoryKnowledge: string[];
    complianceRules: string[];
    referenceAssetIds: string[];
    sourceProjectIds: string[];
    revision: number;
    createdAt: number;
    updatedAt: number;
};

export type ProductDetailProject = {
    id: string;
    userId: number;
    name: string;
    status: ProductDetailProjectStatus;
    platform: ProductDetailPlatform;
    brief: ProductBrief;
    skillIds: string[];
    selectedTemplateId?: string;
    conversationId: string;
    textModel?: string;
    imageModel?: string;
    messages: ProductDetailConversationMessage[];
    storyboard?: Storyboard;
    pageSpecs: PageSpec[];
    assets: ProductDetailAsset[];
    createdAt: number;
    updatedAt: number;
    lastExportedAt?: number;
};

export type ProductDetailWorkspace = {
    version: number;
    projects: ProductDetailProject[];
    skills: UserDesignSkill[];
    activeProjectId?: string;
    updatedAt: number;
};

export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type TextStyle = {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    color: string;
    align: "left" | "center" | "right";
    letterSpacing?: number;
};

export type PageLayer =
    | { type: "image"; assetId: string; rect: Rect; fit: "cover" | "contain"; radius?: number }
    | { type: "text"; text: string; style: TextStyle; rect: Rect }
    | { type: "shape"; fill: string; radius: number; rect: Rect }
    | { type: "gradient"; colors: string[]; direction: "vertical" | "horizontal"; rect: Rect };

export type PageSpec = {
    id: string;
    pageId: string;
    width: number;
    height: number;
    background: string;
    layers: PageLayer[];
    overflowStatus: "ok" | "warning" | "error";
    validation: ValidationResult[];
};

export type ValidationResult = {
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
    field?: string;
};

export type ProductDetailPlatformProfile = {
    id: ProductDetailPlatform;
    label: string;
    width: number;
    format: "jpeg" | "png";
    maxFileSizeBytes: number;
    maxSliceHeight: number;
    note: string;
};
