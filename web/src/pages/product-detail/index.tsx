import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Tabs, Tag } from "antd";
import { PackageSearch, Plus, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { BriefSummaryPanel } from "@/components/product-detail/brief-summary-panel";
import { ConversationPanel } from "@/components/product-detail/conversation-panel";
import { ProjectRail } from "@/components/product-detail/project-rail";
import { SkillManagerModal } from "@/components/product-detail/skill-manager";
import { StoryboardPanel } from "@/components/product-detail/storyboard-panel";
import { RenderPreview } from "@/components/product-detail/render-preview";
import { isProductBriefReady, mergeProductBrief } from "@/lib/product-detail/brief";
import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import { normalizeStoryboard, reorderStoryboard, updateStoryboardPage } from "@/lib/product-detail/storyboard";
import { buildSkillCandidate, mergeSkillCandidate } from "@/lib/product-detail/skills";
import { resolveProductDetailImageModel, resolveProductDetailTextModel } from "@/lib/product-detail/models";
import { useProductDetailStore } from "@/stores/use-product-detail-store";
import { modelOptionName, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { requestProductDetailTurn } from "@/services/product-detail/conversation";
import { requestProductDetailStoryboard } from "@/services/product-detail/storyboard";
import { generateStoryboardImage } from "@/services/product-detail/image-generation";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import type { ProductDetailAgentAction, ProductDetailAsset, ProductDetailConversationMessage, UserDesignSkillPatch, StoryboardPage } from "@/types/product-detail";

export default function ProductDetailPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const config = useEffectiveConfig();
    const {
        workspace, load, createProject, selectProject, deleteProject, updateBrief, appendMessage,
        setStoryboard, confirmStoryboard, addAsset, removeAsset, createSkill, deleteSkill, toggleSkill, attachSkill, setProjectModel,
    } = useProductDetailStore();
    const [skillOpen, setSkillOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [storyboardBusy, setStoryboardBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [generatingPageIds, setGeneratingPageIds] = useState<string[]>([]);
    const [generatingAll, setGeneratingAll] = useState(false);
    const [rightTab, setRightTab] = useState("brief");
    const [focusToken, setFocusToken] = useState(0);
    const generatingRef = useRef<Set<string>>(new Set());

    useEffect(() => { void load(); }, [load]);

    const activeProject = useMemo(() => workspace.projects.find((project) => project.id === workspace.activeProjectId) || workspace.projects[0], [workspace.activeProjectId, workspace.projects]);
    const activeSkill = useMemo(() => {
        if (!activeProject) return workspace.skills.find((skill) => skill.enabled);
        return workspace.skills.find((skill) => activeProject.skillIds.includes(skill.id) && skill.enabled) || workspace.skills.find((skill) => skill.enabled);
    }, [activeProject, workspace.skills]);
    const attachments = activeProject?.assets.filter((asset) => asset.kind === "product" || asset.kind === "reference") || [];
    const textModels = useMemo(() => selectableModelsByCapability(config, "text").map((value) => ({ value, label: modelOptionName(value) })), [config]);
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").map((value) => ({ value, label: modelOptionName(value) })), [config]);
    const selectedTextModel = activeProject ? resolveProductDetailTextModel(activeProject, config) : "";
    const selectedImageModel = activeProject ? resolveProductDetailImageModel(activeProject, config) : "";
    const textModelValue = textModels.some((model) => model.value === selectedTextModel) ? selectedTextModel : textModels[0]?.value || "";
    const imageModelValue = imageModels.some((model) => model.value === selectedImageModel) ? selectedImageModel : imageModels[0]?.value || "";

    const createProjectNow = () => {
        createProject("新商品详情页", "taobao");
        setRightTab("brief");
        setPrompt("");
        setFocusToken((value) => value + 1);
    };

    const send = async (textOverride?: string) => {
        if (!activeProject || busy) return;
        const text = String(textOverride ?? prompt).trim();
        if (!text) return;
        if (!textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return; }
        const userMessage: ProductDetailConversationMessage = {
            id: nanoid(),
            role: "user",
            content: text,
            createdAt: Date.now(),
            assetIds: attachments.map((asset) => asset.id),
        };
        appendMessage(activeProject.id, userMessage);
        if (!textOverride) setPrompt("");
        setBusy(true);
        try {
            const turn = await requestProductDetailTurn(
                { ...config, model: textModelValue, textModel: textModelValue },
                { brief: activeProject.brief, messages: activeProject.messages, skill: activeSkill, userMessage: text, attachments, storyboard: activeProject.storyboard },
            );
            const nextBrief = turn.briefPatch ? mergeProductBrief(activeProject.brief, turn.briefPatch) : activeProject.brief;
            if (turn.briefPatch) updateBrief(activeProject.id, turn.briefPatch);
            const skill = activeSkill || buildSkillCandidate(activeProject);
            if (turn.storyboard) setStoryboard(activeProject.id, normalizeStoryboard(turn.storyboard, nextBrief, skill));
            appendMessage(activeProject.id, { id: nanoid(), role: "assistant", content: turn.message, createdAt: Date.now(), turn });
        } catch (error) {
            appendMessage(activeProject.id, { id: nanoid(), role: "assistant", content: t("productDetail.assistantUnavailable"), createdAt: Date.now(), error: error instanceof Error ? error.message : String(error) });
        } finally { setBusy(false); }
    };

    const generateStoryboard = async () => {
        if (!activeProject) return;
        if (!textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return; }
        if (!isProductBriefReady(activeProject.brief)) { message.warning(t("productDetail.briefRequired")); return; }
        setStoryboardBusy(true);
        try {
            const storyboard = await requestProductDetailStoryboard({ ...config, model: textModelValue, textModel: textModelValue }, activeProject.brief, activeSkill || buildSkillCandidate(activeProject));
            setStoryboard(activeProject.id, storyboard);
            setRightTab("storyboard");
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setStoryboardBusy(false); }
    };

    const uploadAttachments = async (kind: "product" | "reference", files: FileList | null) => {
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
            setFocusToken((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setUploading(false); }
    };

    const removeAttachment = async (assetId: string) => {
        if (!activeProject) return;
        const asset = activeProject.assets.find((item) => item.id === assetId);
        removeAsset(activeProject.id, assetId);
        if (asset?.storageKey) await deleteStoredImages([asset.storageKey]).catch(() => undefined);
    };

    const persistSkill = (candidate?: UserDesignSkillPatch) => {
        if (!activeProject) return;
        const skillId = createSkill(mergeSkillCandidate(buildSkillCandidate(activeProject), candidate));
        attachSkill(activeProject.id, skillId);
        setSkillOpen(false);
        message.success(t("productDetail.skillCreated"));
    };

    const generatePage = async (page: StoryboardPage, notify = true) => {
        if (!activeProject) return;
        if (!imageModelValue) { message.warning("后台创作分组还没有配置生图模型。"); return; }
        if (!activeProject.storyboard || activeProject.storyboard.status !== "confirmed") { message.warning(t("productDetail.storyboardRequired")); return; }
        if (generatingRef.current.has(page.id)) return;
        generatingRef.current.add(page.id);
        setGeneratingPageIds(Array.from(generatingRef.current));
        const currentProject = useProductDetailStore.getState().workspace.projects.find((project) => project.id === activeProject.id);
        if (currentProject?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(currentProject.storyboard, page.id, { status: "generating", error: undefined }));
        try {
            const imageConfig = { ...config, model: imageModelValue, imageModel: imageModelValue };
            const asset = await generateStoryboardImage(imageConfig, { ...activeProject, imageModel: imageModelValue }, page, activeSkill || buildSkillCandidate(activeProject));
            addAsset(activeProject.id, asset);
            const latest = useProductDetailStore.getState().workspace.projects.find((project) => project.id === activeProject.id);
            if (latest?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(latest.storyboard, page.id, { status: "ready", generatedAssetId: asset.id, error: undefined }));
            if (notify) message.success(`第 ${page.order} 页底图已生成`);
        } catch (error) {
            const latest = useProductDetailStore.getState().workspace.projects.find((project) => project.id === activeProject.id);
            if (latest?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(latest.storyboard, page.id, { status: "failed", error: error instanceof Error ? error.message : String(error) }));
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            generatingRef.current.delete(page.id);
            setGeneratingPageIds(Array.from(generatingRef.current));
        }
    };

    const generateAll = async () => {
        if (!activeProject?.storyboard || activeProject.storyboard.status !== "confirmed") { message.warning(t("productDetail.storyboardRequired")); return; }
        if (!imageModelValue) { message.warning("后台创作分组还没有配置生图模型。"); return; }
        setGeneratingAll(true);
        try {
            const queue = activeProject.storyboard.pages.filter((item) => !item.generatedAssetId && item.status !== "generating");
            let cursor = 0;
            const worker = async () => {
                while (cursor < queue.length) {
                    const page = queue[cursor];
                    cursor += 1;
                    await generatePage(page, false);
                }
            };
            await Promise.all([worker(), worker()]);
            setRightTab("results");
            message.success("本轮分镜底图已处理完成，失败页可以单独重试");
        } finally { setGeneratingAll(false); }
    };

    const requestStoryboardChange = (request: string) => {
        if (!textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return; }
        setPrompt(request);
        setFocusToken((value) => value + 1);
    };

    const handleAgentAction = (action: ProductDetailAgentAction, agentMessage: ProductDetailConversationMessage) => {
        if (action.type === "plan_storyboard") { void generateStoryboard(); return; }
        if (action.type === "generate_all_images") { void generateAll(); return; }
        if (action.type === "open_results") { setRightTab("results"); return; }
        if (action.type === "open_export") { setRightTab("export"); return; }
        if (action.type === "save_skill") { persistSkill(agentMessage.turn?.skillCandidate); }
    };

    const movePage = (pageId: string, offset: number) => {
        if (activeProject?.storyboard) setStoryboard(activeProject.id, reorderStoryboard(activeProject.storyboard, pageId, offset));
    };
    const deletePage = (pageId: string) => {
        if (!activeProject?.storyboard) return;
        const pages = activeProject.storyboard.pages.filter((page) => page.id !== pageId).map((page, index) => ({ ...page, order: index + 1 }));
        setStoryboard(activeProject.id, { ...activeProject.storyboard, status: "draft", revision: activeProject.storyboard.revision + 1, pages });
    };

    const rightTabs = [
        { key: "brief", label: t("productDetail.brief") },
        { key: "storyboard", label: t("productDetail.storyboard") },
        { key: "results", label: t("productDetail.results") },
        { key: "export", label: t("productDetail.export") },
    ];

    return (
        <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <ProjectRail projects={workspace.projects} skills={workspace.skills} activeProjectId={activeProject?.id} onSelect={(id) => { selectProject(id); setRightTab("brief"); }} onCreate={createProjectNow} onDelete={(id) => modal.confirm({ title: t("common.delete"), content: "确定删除这个详情页项目吗？", okText: t("common.delete"), okButtonProps: { danger: true }, cancelText: t("common.cancel"), onOk: () => deleteProject(id) })} onOpenSkills={() => setSkillOpen(true)} />
            {activeProject ? (
                <>
                    <ConversationPanel messages={activeProject.messages} value={prompt} busy={busy} storyboardBusy={storyboardBusy} canPlan={isProductBriefReady(activeProject.brief)} models={textModels} modelValue={textModelValue} imageModels={imageModels} imageModelValue={imageModelValue} attachments={attachments} uploading={uploading} focusToken={focusToken} onChange={setPrompt} onModelChange={(model) => setProjectModel(activeProject.id, "text", model)} onImageModelChange={(model) => setProjectModel(activeProject.id, "image", model)} onUpload={(kind, files) => void uploadAttachments(kind, files)} onRemoveAttachment={(assetId) => void removeAttachment(assetId)} onSend={() => void send()} onGenerateStoryboard={() => void generateStoryboard()} onQuickReply={(text) => void send(text)} onAction={handleAgentAction} />
                    <aside className="flex min-h-0 w-[430px] shrink-0 flex-col border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950/60">
                        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800"><div className="flex min-w-0 items-center gap-2"><PackageSearch className="size-4 shrink-0 text-orange-500" /><span className="truncate text-sm font-semibold">{activeProject.name}</span><Tag className="m-0 shrink-0">{PRODUCT_DETAIL_PLATFORM_PROFILES[activeProject.brief.platform].label}</Tag></div><Button size="small" type="text" icon={<Sparkles className="size-3.5" />} onClick={() => setSkillOpen(true)}>{t("productDetail.skills")}</Button></div>
                        <Tabs activeKey={rightTab} onChange={setRightTab} items={rightTabs} className="px-3 pt-2" />
                        {rightTab === "brief" ? <BriefSummaryPanel brief={activeProject.brief} assets={attachments} /> : null}
                        {rightTab === "storyboard" ? <StoryboardPanel storyboard={activeProject.storyboard} assets={activeProject.assets} generatingPageIds={generatingPageIds} onMove={movePage} onDelete={deletePage} onConfirm={() => confirmStoryboard(activeProject.id)} onGenerate={(page) => generatePage(page)} onGenerateAll={generateAll} generatingAll={generatingAll} onRequestChange={requestStoryboardChange} /> : null}
                        {rightTab === "results" ? <RenderPreview project={activeProject} platform={activeProject.brief.platform} skill={activeSkill || buildSkillCandidate(activeProject)} onGenerateImage={(page) => generatePage(page)} /> : null}
                        {rightTab === "export" ? <RenderPreview project={activeProject} platform={activeProject.brief.platform} skill={activeSkill || buildSkillCandidate(activeProject)} onGenerateImage={(page) => generatePage(page)} /> : null}
                    </aside>
                </>
            ) : (
                <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 text-center dark:bg-stone-950"><div className="flex size-16 items-center justify-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><PackageSearch className="size-7" /></div><h1 className="mt-5 text-xl font-semibold">{t("productDetail.title")}</h1><p className="mt-2 max-w-md text-sm leading-6 text-stone-500">{t("productDetail.emptyProjectsHint")}</p><Button type="primary" icon={<Plus className="size-4" />} className="mt-5" onClick={createProjectNow}>{t("productDetail.newProject")}</Button></main>
            )}
            <SkillManagerModal open={skillOpen} skills={workspace.skills} canCreate={Boolean(activeProject)} onClose={() => setSkillOpen(false)} onToggle={toggleSkill} onDelete={(id) => deleteSkill(id)} onCreateFromProject={() => persistSkill()} onAttach={(skillId) => { if (activeProject) attachSkill(activeProject.id, skillId); }} />
        </div>
    );
}
