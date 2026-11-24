import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Tabs } from "antd";
import { PackageSearch, Plus, Sparkles, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { BriefSummaryPanel } from "@/components/product-detail/brief-summary-panel";
import { ConversationPanel, type ProductDetailOperation } from "@/components/product-detail/conversation-panel";
import { ProjectRail } from "@/components/product-detail/project-rail";
import { SkillManagerModal, type CustomSkillInput } from "@/components/product-detail/skill-manager";
import { StoryboardPanel } from "@/components/product-detail/storyboard-panel";
import { RenderPreview } from "@/components/product-detail/render-preview";
import { isProductBriefReady, mergeProductBrief, missingProductBriefFields } from "@/lib/product-detail/brief";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import { classifyProductDetailGenerationIntent } from "@/lib/product-detail/intent";
import { isStoryboardStale, keepStoryboardForEditing, normalizeStoryboard, reorderStoryboard, resolveStoryboardGenerationStatus, updateStoryboardPage } from "@/lib/product-detail/storyboard";
import { buildSkillCandidate, findBestSkill } from "@/lib/product-detail/skills";
import { resolveProductDetailImageModel, resolveProductDetailTextModel } from "@/lib/product-detail/models";
import { hasProductImageReference } from "@/lib/product-detail/reference-selection";
import { assetStorageKeysForProjectDeletion } from "@/lib/product-detail/workspace";
import { useProductDetailStore } from "@/stores/use-product-detail-store";
import { modelOptionName, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { requestProductDetailTurn } from "@/services/product-detail/conversation";
import { requestProductDetailStoryboard } from "@/services/product-detail/storyboard";
import { generateStoryboardImage } from "@/services/product-detail/image-generation";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import type { ProductDetailAgentAction, ProductDetailAsset, ProductDetailConversationMessage, ProductDetailProjectStatus, UserDesignSkillPatch, Storyboard, StoryboardPage } from "@/types/product-detail";

export default function ProductDetailPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const config = useEffectiveConfig();
    const {
        workspace, load, createProject, selectProject, deleteProject, updateBrief, appendMessage,
        setStoryboard, confirmStoryboard, setProjectStatus, addAsset, removeAsset, createSkill, updateSkill, saveProjectSkill, deleteSkill, toggleSkill, attachSkill, setProjectModel,
    } = useProductDetailStore();
    const [skillOpen, setSkillOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [operation, setOperation] = useState<ProductDetailOperation | null>(null);
    const [confirmationDismissedRevision, setConfirmationDismissedRevision] = useState(-1);
    const [autoConfirmationRevision, setAutoConfirmationRevision] = useState(-1);
    const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>([]);
    const [storyboardBusy, setStoryboardBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [generatingPageIds, setGeneratingPageIds] = useState<string[]>([]);
    const [generatingAll, setGeneratingAll] = useState(false);
    const [rightTab, setRightTab] = useState("brief");
    const [detailOpen, setDetailOpen] = useState(false);
    const [focusToken, setFocusToken] = useState(0);
    const generatingRef = useRef<Set<string>>(new Set());
    const implementationRef = useRef(false);

    useEffect(() => { void load(); }, [load]);

    const activeProject = useMemo(() => workspace.projects.find((project) => project.id === workspace.activeProjectId) || workspace.projects[0], [workspace.activeProjectId, workspace.projects]);
    const activeSkill = useMemo(() => activeProject ? findBestSkill(workspace.skills, activeProject) : workspace.skills.find((skill) => skill.enabled), [activeProject, workspace.skills]);
    const canCreateSkill = Boolean(activeProject && (activeProject.storyboard?.pages.length || activeProject.brief.sellingPoints.length || activeProject.brief.visualStyle.length || activeProject.brief.colorPreference.length || activeProject.brief.copyTone.length));
    const attachments = activeProject?.assets.filter((asset) => asset.kind === "product" || asset.kind === "reference") || [];
    const composerAttachments = useMemo(() => attachments.filter((asset) => pendingAttachmentIds.includes(asset.id)), [attachments, pendingAttachmentIds]);
    useEffect(() => { setConfirmationDismissedRevision(-1); setAutoConfirmationRevision(-1); setPendingAttachmentIds([]); setDetailOpen(false); }, [activeProject?.id]);

    const textModels = useMemo(() => selectableModelsByCapability(config, "text").map((value) => ({ value, label: modelOptionName(value) })), [config]);
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").map((value) => ({ value, label: modelOptionName(value) })), [config]);
    const selectedTextModel = activeProject ? resolveProductDetailTextModel(activeProject, config) : "";
    const selectedImageModel = activeProject ? resolveProductDetailImageModel(activeProject, config) : "";
    const textModelValue = textModels.some((model) => model.value === selectedTextModel) ? selectedTextModel : textModels[0]?.value || "";
    const imageModelValue = imageModels.some((model) => model.value === selectedImageModel) ? selectedImageModel : imageModels[0]?.value || "";
    const storyboardStale = Boolean(activeProject && isStoryboardStale(activeProject.storyboard, activeProject.brief));
    const showGenerationConfirmation = Boolean(activeProject && autoConfirmationRevision === activeProject.brief.revision && isProductBriefReady(activeProject.brief) && (!activeProject.storyboard || storyboardStale) && !busy && !storyboardBusy && !generatingAll && !operation && confirmationDismissedRevision !== activeProject.brief.revision);

    const openWorkspace = (tab?: string) => {
        if (tab) setRightTab(tab);
        setDetailOpen(true);
    };
    const createProjectNow = () => {
        createProject("新商品详情页", "taobao");
        setRightTab("brief");
        setDetailOpen(false);
        setPrompt("");
        setFocusToken((value) => value + 1);
    };
    const deleteProjectNow = (projectId: string) => {
        const storageKeys = assetStorageKeysForProjectDeletion(workspace, projectId);
        modal.confirm({
            title: t("common.delete"),
            content: "确定删除这个详情页项目吗？项目内的生成图片也会从本地清理。",
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                if (storageKeys.length) await deleteStoredImages(storageKeys).catch(() => undefined);
                deleteProject(projectId);
                message.success(t("productDetail.projectDeleted"));
            },
        });
    };

    const requestAndSetStoryboard = async (projectId: string): Promise<Storyboard | null> => {
        const project = useProductDetailStore.getState().workspace.projects.find((item) => item.id === projectId);
        if (!project) return null;
        if (!textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return null; }
        if (!isProductBriefReady(project.brief)) { message.warning(t("productDetail.briefRequired")); return null; }
        setStoryboardBusy(true);
        try {
            const storyboard = await requestProductDetailStoryboard(
                { ...config, model: textModelValue, textModel: textModelValue },
                project.brief,
                activeSkill || buildSkillCandidate(project),
                project.assets.filter((asset) => asset.kind === "product" || asset.kind === "reference"),
            );
            setStoryboard(projectId, storyboard);
            if (storyboard.warning) message.warning(storyboard.warning);
            openWorkspace("storyboard");
            return storyboard;
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
            return null;
        } finally {
            setStoryboardBusy(false);
        }
    };

    const generateStoryboard = async (): Promise<Storyboard | null> => {
        if (!activeProject || implementationRef.current) return null;
        implementationRef.current = true;
        setOperation({ kind: "storyboard", startedAt: Date.now(), label: "正在生成页面分镜" });
        try {
            return await requestAndSetStoryboard(activeProject.id);
        } finally {
            implementationRef.current = false;
            setOperation(null);
        }
    };

    const uploadAttachments = async (kind: "product" | "reference", files: FileList | File[] | null) => {
        if (!activeProject || !files?.length) return;
        setUploading(true);
        try {
            const uploaded = await Promise.all(Array.from(files).map(async (file) => {
                const image = await uploadImage(file);
                const asset: ProductDetailAsset = { id: nanoid(), name: file.name, kind, storageKey: image.storageKey, url: image.url, mimeType: image.mimeType || "image/png", width: image.width, height: image.height, bytes: image.bytes, createdAt: Date.now() };
                addAsset(activeProject.id, asset);
                return asset.id;
            }));
            updateBrief(activeProject.id, kind === "product"
                ? { productAssetIds: [...activeProject.brief.productAssetIds, ...uploaded] }
                : { referenceAssetIds: [...activeProject.brief.referenceAssetIds, ...uploaded] });
            setPendingAttachmentIds((current) => Array.from(new Set([...current, ...uploaded])));
            setFocusToken((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setUploading(false); }
    };

    const removeAttachment = async (assetId: string) => {
        if (!activeProject) return;
        const asset = activeProject.assets.find((item) => item.id === assetId);
        removeAsset(activeProject.id, assetId);
        setPendingAttachmentIds((current) => current.filter((id) => id !== assetId));
        if (asset?.storageKey) await deleteStoredImages([asset.storageKey]).catch(() => undefined);
    };

    const createCustomSkill = (input: CustomSkillInput) => {
        const skillId = createSkill({
            name: input.name,
            description: input.description || "用户自定义的本地设计 Skill。",
            enabled: true,
            scope: input.scope,
            category: input.scope === "category" ? input.category : undefined,
            platform: input.scope === "platform" ? input.platform : undefined,
            pagePatterns: input.pagePatterns,
            categoryKnowledge: input.categoryKnowledge.length ? input.categoryKnowledge : input.category ? [input.category] : [],
            complianceRules: input.complianceRules,
            copy: { forbiddenPhrases: input.forbiddenPhrases },
        });
        if (activeProject) attachSkill(activeProject.id, skillId);
        message.success(t("productDetail.skillCreated"));
    };

    const updateCustomSkill = (skillId: string, input: CustomSkillInput) => {
        updateSkill(skillId, {
            name: input.name,
            description: input.description || "用户自定义的本地设计 Skill。",
            scope: input.scope,
            category: input.scope === "category" ? input.category : undefined,
            platform: input.scope === "platform" ? input.platform : undefined,
            pagePatterns: input.pagePatterns,
            categoryKnowledge: input.categoryKnowledge.length ? input.categoryKnowledge : input.category ? [input.category] : [],
            complianceRules: input.complianceRules,
            copy: { forbiddenPhrases: input.forbiddenPhrases },
        });
        if (activeProject) attachSkill(activeProject.id, skillId);
        message.success(t("productDetail.skillUpdated"));
    };

    const persistSkill = (candidate?: UserDesignSkillPatch) => {
        if (!activeProject) return;
        const result = saveProjectSkill(activeProject.id, candidate);
        if (!result) return;
        setSkillOpen(false);
        message.success(result.created ? t("productDetail.skillCreated") : t("productDetail.skillUpdated"));
    };

    const generatePage = async (page: StoryboardPage, notify = true): Promise<boolean> => {
        if (!activeProject) return false;
        if (!imageModelValue) { message.warning("后台创作分组还没有配置生图模型。"); return false; }
        const project = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject.id);
        if (!project || !hasProductImageReference(project.assets)) { message.warning("请先上传至少一张商品图，避免生图时编造商品外观。"); return false; }
        if (!project?.storyboard || project.storyboard.status !== "confirmed" || isStoryboardStale(project.storyboard, project.brief)) {
            message.warning(t("productDetail.storyboardRequired"));
            return false;
        }
        if (project.storyboard.warning) {
            message.warning("当前分镜不是由 AI 正确生成，请重新生成分镜后再生成图片，避免产生错误费用。");
            return false;
        }
        if (generatingRef.current.has(page.id)) return false;
        const currentPage = project.storyboard.pages.find((item) => item.id === page.id) || page;
        generatingRef.current.add(page.id);
        setGeneratingPageIds(Array.from(generatingRef.current));
        setStoryboard(activeProject.id, updateStoryboardPage(project.storyboard, page.id, { status: "generating", error: undefined }));
        try {
            const imageConfig = { ...config, model: imageModelValue, imageModel: imageModelValue };
            const asset = await generateStoryboardImage(imageConfig, { ...project, imageModel: imageModelValue }, currentPage, activeSkill || buildSkillCandidate(project));
            addAsset(activeProject.id, asset);
            const latest = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject.id);
            if (latest?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(latest.storyboard, page.id, { status: "ready", generatedAssetId: asset.id, error: undefined }));
            if (notify) message.success(`“${page.title}”底图已生成`);
            return true;
        } catch (error) {
            const latest = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject.id);
            if (latest?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(latest.storyboard, page.id, { status: "failed", error: error instanceof Error ? error.message : String(error) }));
            message.error(error instanceof Error ? error.message : String(error));
            return false;
        } finally {
            generatingRef.current.delete(page.id);
            setGeneratingPageIds(Array.from(generatingRef.current));
        }
    };

    const generateAll = async (manageProgress = true): Promise<{ total: number; success: number; failed: number }> => {
        if (!activeProject) return { total: 0, success: 0, failed: 0 };
        const project = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject.id);
        if (!project || !hasProductImageReference(project.assets)) { message.warning("请先上传至少一张商品图，避免生图时编造商品外观。"); return { total: 0, success: 0, failed: 0 }; }
        if (!project?.storyboard || project.storyboard.status !== "confirmed" || isStoryboardStale(project.storyboard, project.brief)) {
            message.warning(t("productDetail.storyboardRequired"));
            return { total: 0, success: 0, failed: 0 };
        }
        if (!imageModelValue) { message.warning("后台创作分组还没有配置生图模型。"); return { total: 0, success: 0, failed: 0 }; }
        if (project.storyboard.warning) {
            message.warning("当前分镜不是由 AI 正确生成，请重新生成分镜后再生成图片，避免产生错误费用。");
            return { total: 0, success: 0, failed: 0 };
        }
        const queue = project.storyboard.pages.filter((item) => !item.generatedAssetId && item.status !== "generating");
        if (!queue.length) {
            const allReady = project.storyboard.pages.length > 0 && project.storyboard.pages.every((page) => Boolean(page.generatedAssetId));
            if (allReady) setProjectStatus(activeProject.id, "review");
            if (manageProgress) message.info("当前没有需要生成的页面。");
            return { total: 0, success: 0, failed: 0 };
        }
        setGeneratingAll(true);
        if (manageProgress) setOperation({ kind: "images", startedAt: Date.now(), label: "正在生成页面图片" });
        let success = 0;
        let failed = 0;
        try {
            let cursor = 0;
            const worker = async () => {
                while (cursor < queue.length) {
                    const page = queue[cursor];
                    cursor += 1;
                    if (await generatePage(page, false)) success += 1;
                    else failed += 1;
                }
            };
            await Promise.all([worker(), worker()]);
            const latestProject = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject.id);
            const latestPages = latestProject?.storyboard?.pages || [];
            const allReady = latestPages.length > 0 && latestPages.every((page) => Boolean(page.generatedAssetId));
            setProjectStatus(activeProject.id, resolveStoryboardGenerationStatus(latestPages));
            openWorkspace("results");
            if (!success && failed) message.warning(`本轮生成失败：${failed} 页。`);
            else if (failed) message.warning(`本轮生成完成：成功 ${success} 页，失败 ${failed} 页。`);
            else message.success(`本轮生成完成：成功 ${success} 页。`);
            return { total: queue.length, success, failed };
        } finally {
            setGeneratingAll(false);
            if (manageProgress) setOperation(null);
        }
    };

    const startImplementation = async (projectId: string) => {
        if (implementationRef.current) return;
        let project = useProductDetailStore.getState().workspace.projects.find((item) => item.id === projectId);
        if (!project) return;
        if (!isProductBriefReady(project.brief)) {
            const missing = missingProductBriefFields(project.brief);
            appendMessage(projectId, { id: nanoid(), role: "assistant", content: `还不能开始生成，还需要确认：${missing.join("、")}。`, createdAt: Date.now() });
            message.warning(t("productDetail.briefRequired"));
            return;
        }
        implementationRef.current = true;
        try {
            if (!project.storyboard || isStoryboardStale(project.storyboard, project.brief)) {
                setOperation({ kind: "storyboard", startedAt: Date.now(), label: "正在生成页面分镜" });
                const storyboard = await requestAndSetStoryboard(projectId);
                if (!storyboard) return;
                if (storyboard.warning) {
                    appendMessage(projectId, {
                        id: nanoid(),
                        role: "assistant",
                        content: "分镜没有由 AI 正确生成，已停止后续生图。请重新生成分镜并检查无误后再确认，避免产生错误费用。",
                        createdAt: Date.now(),
                    });
                    return;
                }
                appendMessage(projectId, {
                    id: nanoid(),
                    role: "assistant",
                    content: `已生成 ${storyboard.pages.length} 页分镜。请先检查页面顺序、文案和视觉方向；确认分镜后再点击“生成全部底图”才会开始计费生图。`,
                    createdAt: Date.now(),
                });
                openWorkspace("storyboard");
                return;
            }
            if (project.storyboard.warning) {
                appendMessage(projectId, {
                    id: nanoid(),
                    role: "assistant",
                    content: "当前分镜不是由 AI 正确生成，不能继续生图。请重新生成分镜并确认。",
                    createdAt: Date.now(),
                });
                openWorkspace("storyboard");
                return;
            }
            if (project.storyboard.status !== "confirmed") {
                appendMessage(projectId, {
                    id: nanoid(),
                    role: "assistant",
                    content: "分镜还需要你确认。请在右侧检查后点击“确认分镜”，再点击“生成全部底图”；确认分镜本身不会扣生图费用。",
                    createdAt: Date.now(),
                });
                openWorkspace("storyboard");
                return;
            }
            if (!imageModelValue) {
                appendMessage(projectId, { id: nanoid(), role: "assistant", content: "分镜已确认，但后台创作分组没有配置生图模型，暂时不能生成页面图片。", createdAt: Date.now() });
                message.warning("后台创作分组还没有配置生图模型。");
                openWorkspace("storyboard");
                return;
            }
            setOperation({ kind: "images", startedAt: Date.now(), label: "正在生成页面图片" });
            const result = await generateAll(false);
            appendMessage(projectId, {
                id: nanoid(),
                role: "assistant",
                content: result.total === 0
                    ? "当前没有需要生成的页面，已生成的分镜会继续保存在本地。"
                    : `本轮生成完成：成功 ${result.success} 页，失败 ${result.failed} 页。${result.failed ? "失败页面可以在生成结果中单独重试。" : "页面已保存到本地，可以在生成结果中查看。"}`,
                createdAt: Date.now(),
            });
        } finally {
            implementationRef.current = false;
            setOperation(null);
            setGeneratingAll(false);
        }
    };

    const send = async (textOverride?: string) => {
        if (!activeProject || busy || storyboardBusy || generatingAll) return;
        const typedText = String(textOverride ?? prompt).trim();
        const turnAttachments = composerAttachments;
        if (!typedText && !turnAttachments.length) return;
        const text = typedText || "请先分析我上传的商品图和参考图，提取商品信息、配色、材质、花型和版式特征，并只追问还缺失的关键信息。";
        setConfirmationDismissedRevision(-1);
        setAutoConfirmationRevision(-1);
        const intent = classifyProductDetailGenerationIntent(text);
        if (!intent && !textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return; }
        const visualAttachments = Array.from(new Map<string, ProductDetailAsset>([...attachments.filter((asset) => asset.kind === "product"), ...turnAttachments, ...attachments.filter((asset) => asset.kind === "reference")].map((asset) => [asset.id, asset])).values());
        const includeStoryboard = /分镜|页面结构|第\s*[一二三四五六七八九十百\d]+\s*页|新增一页|删除.{0,6}页|调整.{0,6}页/.test(text);
        const userMessage: ProductDetailConversationMessage = {
            id: nanoid(),
            role: "user",
            content: text,
            createdAt: Date.now(),
            assetIds: intent || !turnAttachments.length ? undefined : turnAttachments.map((asset) => asset.id),
        };
        appendMessage(activeProject.id, userMessage);
        setPendingAttachmentIds([]);
        if (!textOverride) setPrompt("");
        if (intent === "storyboard") { await generateStoryboard(); return; }
        if (intent === "images") { await startImplementation(activeProject.id); return; }
        setBusy(true);
        setOperation({ kind: "thinking", startedAt: Date.now(), label: "正在理解你的需求" });
        try {
            const turn = await requestProductDetailTurn(
                { ...config, model: textModelValue, textModel: textModelValue },
                { brief: activeProject.brief, messages: activeProject.messages, skill: activeSkill, userMessage: text, attachments: visualAttachments, storyboard: includeStoryboard ? activeProject.storyboard : undefined },
            );
            if (turn.briefPatch) updateBrief(activeProject.id, turn.briefPatch);
            const committedProject = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject.id);
            const nextBrief = committedProject?.brief || (turn.briefPatch ? mergeProductBrief(activeProject.brief, turn.briefPatch) : activeProject.brief);
            const ready = isProductBriefReady(nextBrief);
            const missing = ready ? [] : missingProductBriefFields(nextBrief);
            const normalizedTurn = {
                ...turn,
                readyToPlan: ready,
                actions: turn.actions?.filter((action) => action.type !== "plan_storyboard" && action.type !== "generate_all_images"),
            };
            const content = !ready && /信息.*足够|可以生成/.test(turn.message)
                ? `目前还不能开始生成，还缺：${missing.join("、")}。${turn.message}`
                : turn.message;
            const skill = activeSkill || buildSkillCandidate(activeProject);
            if (turn.storyboard) setStoryboard(activeProject.id, normalizeStoryboard(turn.storyboard, nextBrief, skill));
            appendMessage(activeProject.id, { id: nanoid(), role: "assistant", content, createdAt: Date.now(), turn: normalizedTurn });
            setAutoConfirmationRevision(ready ? nextBrief.revision : -1);
        } catch (error) {
            appendMessage(activeProject.id, { id: nanoid(), role: "assistant", content: t("productDetail.assistantUnavailable"), createdAt: Date.now(), error: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
            setOperation(null);
        }
    };

    const confirmGeneration = () => {
        if (!activeProject || implementationRef.current || busy || storyboardBusy || generatingAll || operation) return;
        setConfirmationDismissedRevision(activeProject.brief.revision);
        setAutoConfirmationRevision(-1);
        appendMessage(activeProject.id, { id: nanoid(), role: "user", content: "确认信息并生成分镜", createdAt: Date.now() });
        void startImplementation(activeProject.id);
    };

    const continueEditing = () => {
        setConfirmationDismissedRevision(activeProject?.brief.revision ?? -1);
        setAutoConfirmationRevision(-1);
        setFocusToken((value) => value + 1);
    };
    const requestStoryboardChange = (request: string) => {
        if (!textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return; }
        setPrompt(request);
        setFocusToken((value) => value + 1);
    };
    const handleAgentAction = (action: ProductDetailAgentAction, agentMessage: ProductDetailConversationMessage) => {
        if (action.type === "plan_storyboard") { void generateStoryboard(); return; }
        if (action.type === "generate_all_images") { if (activeProject) void startImplementation(activeProject.id); return; }
        if (action.type === "open_results") { openWorkspace("results"); return; }
        if (action.type === "open_export") { openWorkspace("export"); return; }
        if (action.type === "save_skill") { persistSkill(agentMessage.turn?.skillCandidate); }
    };

    const keepCurrentStoryboard = () => {
        if (!activeProject?.storyboard) return;
        setStoryboard(activeProject.id, keepStoryboardForEditing(activeProject.storyboard, activeProject.brief));
        openWorkspace("storyboard");
        message.success("已保留当前分镜。请按最新商品信息调整页面，确认后再生成图片。");
    };
    const movePage = (pageId: string, offset: number) => {
        if (!activeProject?.storyboard) return;
        const synced = keepStoryboardForEditing(activeProject.storyboard, activeProject.brief);
        setStoryboard(activeProject.id, reorderStoryboard(synced, pageId, offset));
    };
    const deletePage = (pageId: string) => {
        if (!activeProject?.storyboard) return;
        const synced = keepStoryboardForEditing(activeProject.storyboard, activeProject.brief);
        const pages = synced.pages.filter((page) => page.id !== pageId).map((page, index) => ({ ...page, order: index + 1 }));
        setStoryboard(activeProject.id, { ...synced, revision: synced.revision + 1, pages });
    };
    const updatePageContent = (pageId: string, patch: Pick<StoryboardPage, "title" | "message" | "copy">) => {
        const project = useProductDetailStore.getState().workspace.projects.find((item) => item.id === activeProject?.id);
        if (!project?.storyboard) return;
        const synced = keepStoryboardForEditing(project.storyboard, project.brief);
        setStoryboard(project.id, updateStoryboardPage(synced, pageId, patch));
    };

    const rightTabs = [
        { key: "brief", label: t("productDetail.brief") },
        { key: "storyboard", label: t("productDetail.storyboard") },
        { key: "results", label: t("productDetail.results") },
        { key: "export", label: t("productDetail.export") },
    ];

    return (
        <div className="relative flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden bg-[#f7f6f2] text-[#22211f] dark:bg-[#151412] dark:text-stone-100" data-testid="product-detail-workbench">
            <ProjectRail projects={workspace.projects} skills={workspace.skills} activeProjectId={activeProject?.id} onSelect={(id) => { selectProject(id); setRightTab("brief"); setDetailOpen(false); }} onCreate={createProjectNow} onDelete={deleteProjectNow} onOpenSkills={() => setSkillOpen(true)} />
            {activeProject ? (
                <>
                    <ConversationPanel
                        messages={activeProject.messages}
                        value={prompt}
                        busy={busy}
                        storyboardBusy={storyboardBusy}
                        canPlan={isProductBriefReady(activeProject.brief)}
                        storyboard={activeProject.storyboard}
                        storyboardStale={storyboardStale}
                        projectName={activeProject.name}
                        projectStatus={projectStatusLabel(activeProject.status)}
                        brief={activeProject.brief}
                        detailsOpen={detailOpen}
                        models={textModels}
                        modelValue={textModelValue}
                        imageModels={imageModels}
                        imageModelValue={imageModelValue}
                        allAssets={attachments}
                        attachments={composerAttachments}
                        uploading={uploading}
                        operation={operation}
                        showGenerationConfirmation={showGenerationConfirmation}
                        onConfirmGeneration={confirmGeneration}
                        onContinueEditing={continueEditing}
                        onSupplement={(text) => void send(text)}
                        onToggleDetails={() => setDetailOpen((value) => !value)}
                        focusToken={focusToken}
                        onChange={setPrompt}
                        onModelChange={(model) => setProjectModel(activeProject.id, "text", model)}
                        onImageModelChange={(model) => setProjectModel(activeProject.id, "image", model)}
                        onUpload={(kind, files) => void uploadAttachments(kind, files)}
                        onRemoveAttachment={(assetId) => void removeAttachment(assetId)}
                        onSend={() => void send()}
                        onGenerateStoryboard={() => void generateStoryboard()}
                        onOpenStoryboard={() => { setDetailOpen(true); setRightTab("storyboard"); }}
                        onQuickReply={(text) => void send(text)}
                        onAction={handleAgentAction}
                    />
                    {detailOpen ? (
                        <aside className="flex min-h-0 w-[420px] shrink-0 flex-col border-l border-black/[0.07] bg-[#fbfaf7] shadow-[-18px_0_50px_rgba(38,32,25,0.08)] dark:border-white/[0.07] dark:bg-[#191714] max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:max-w-[calc(100vw-20px)]">
                            <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 dark:border-white/[0.07]">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold tracking-[-0.02em]">项目工作区</div>
                                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-stone-400">
                                        <span className="truncate">{activeProject.name}</span>
                                        <span className="text-stone-300 dark:text-stone-700">·</span>
                                        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-stone-500 dark:bg-white/[0.06] dark:text-stone-400">{PRODUCT_DETAIL_PLATFORM_PROFILES[activeProject.brief.platform].label}</span>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button size="small" type="text" icon={<Sparkles className="size-3.5" />} onClick={() => setSkillOpen(true)} className="rounded-full text-stone-500 hover:!text-stone-900 dark:text-stone-400 dark:hover:!text-white">{t("productDetail.skills")}</Button>
                                    <Button size="small" type="text" icon={<X className="size-4" />} onClick={() => setDetailOpen(false)} aria-label="关闭项目工作区" className="size-8 rounded-full text-stone-500 hover:!bg-stone-100 hover:!text-stone-900 dark:text-stone-400 dark:hover:!bg-white/[0.06] dark:hover:!text-white" />
                                </div>
                            </div>
                            <Tabs activeKey={rightTab} onChange={setRightTab} items={rightTabs} className="px-3 pt-1 [&_.ant-tabs-nav]:mb-0" />
                            {rightTab === "brief" ? <BriefSummaryPanel brief={activeProject.brief} assets={attachments} onUpdate={(patch) => updateBrief(activeProject.id, patch)} onRequestChange={continueEditing} /> : null}
                            {rightTab === "storyboard" ? <StoryboardPanel storyboard={activeProject.storyboard} assets={activeProject.assets} stale={storyboardStale} imageModelAvailable={Boolean(imageModelValue)} generatingPageIds={generatingPageIds} onMove={movePage} onDelete={deletePage} onConfirm={() => confirmStoryboard(activeProject.id)} onGenerate={async (page) => { await generatePage(page); }} onGenerateAll={async () => { await generateAll(); }} onRegenerate={() => void generateStoryboard()} onKeepEditing={keepCurrentStoryboard} generatingAll={generatingAll} onRequestChange={requestStoryboardChange} onUpdatePage={updatePageContent} /> : null}
                            {rightTab === "results" ? <RenderPreview project={activeProject} platform={activeProject.brief.platform} skill={activeSkill || buildSkillCandidate(activeProject)} onGenerateImage={async (page) => { await generatePage(page); }} /> : null}
                            {rightTab === "export" ? <RenderPreview project={activeProject} platform={activeProject.brief.platform} skill={activeSkill || buildSkillCandidate(activeProject)} onGenerateImage={async (page) => { await generatePage(page); }} /> : null}
                        </aside>
                    ) : null}
                </>
            ) : (
                <main className="flex flex-1 flex-col items-center justify-center bg-[#f7f6f2] px-6 text-center dark:bg-[#151412]">
                    <div className="flex size-16 items-center justify-center rounded-[20px] bg-[#22211f] text-white shadow-[0_16px_40px_rgba(34,33,31,0.16)] dark:bg-stone-100 dark:text-stone-950"><PackageSearch className="size-7" /></div>
                    <h1 className="mt-5 text-xl font-semibold tracking-[-0.03em]">{t("productDetail.title")}</h1>
                    <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">{t("productDetail.emptyProjectsHint")}</p>
                    <Button icon={<Plus className="size-4" />} className="mt-5 h-10 rounded-full border-0 bg-[#22211f] px-5 text-xs font-semibold text-white shadow-none hover:!bg-black dark:!bg-stone-100 dark:!text-stone-950 dark:hover:!bg-white dark:hover:!text-stone-950" onClick={createProjectNow}>{t("productDetail.newProject")}</Button>
                </main>
            )}
            <SkillManagerModal open={skillOpen} skills={workspace.skills} projectSkillIds={activeProject?.skillIds || []} recommendedSkillId={activeSkill?.id} canCreateProjectSkill={canCreateSkill} onClose={() => setSkillOpen(false)} onToggle={toggleSkill} onDelete={(id) => deleteSkill(id)} onCreateFromProject={() => persistSkill()} onCreateCustom={createCustomSkill} onUpdateSkill={updateCustomSkill} onAttach={(skillId) => { if (activeProject) attachSkill(activeProject.id, skillId); }} />
        </div>
    );
}

function projectStatusLabel(status: ProductDetailProjectStatus) {
    return ({
        discovery: "正在梳理需求",
        brief_ready: "信息已整理",
        storyboard_draft: "分镜待确认",
        storyboard_confirmed: "分镜已确认",
        generating: "正在生成",
        review: "等待检查",
        completed: "已完成",
        failed: "需要处理",
    } as const)[status];
}
