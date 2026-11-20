import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Tabs, Tag } from "antd";
import { PackageSearch, Plus, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { BriefSummaryPanel } from "@/components/product-detail/brief-summary-panel";
import { ConversationPanel } from "@/components/product-detail/conversation-panel";
import { ProjectRail } from "@/components/product-detail/project-rail";
import { SkillManagerModal } from "@/components/product-detail/skill-manager";
import { StoryboardPanel } from "@/components/product-detail/storyboard-panel";
import { RenderPreview } from "@/components/product-detail/render-preview";
import { createEmptyBrief, isProductBriefReady } from "@/lib/product-detail/brief";
import { createPage, reorderStoryboard, updateStoryboardPage } from "@/lib/product-detail/storyboard";
import { buildSkillCandidate } from "@/lib/product-detail/skills";
import { resolveProductDetailTextModel } from "@/lib/product-detail/models";
import { useProductDetailStore } from "@/stores/use-product-detail-store";
import { modelOptionName, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { requestProductDetailTurn } from "@/services/product-detail/conversation";
import { requestProductDetailStoryboard } from "@/services/product-detail/storyboard";
import { generateStoryboardImage } from "@/services/product-detail/image-generation";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import type { ProductDetailAsset, ProductDetailConversationMessage, ProductDetailPlatform, StoryboardPage } from "@/types/product-detail";

const PLATFORM_OPTIONS = [
    { value: "taobao", label: "淘宝" },
    { value: "tmall", label: "天猫" },
    { value: "jd", label: "京东" },
    { value: "pdd", label: "拼多多" },
];

export default function ProductDetailPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const config = useEffectiveConfig();
    const {
        workspace, load, createProject, selectProject, deleteProject, updateBrief, appendMessage,
        setStoryboard, confirmStoryboard, addAsset, removeAsset, createSkill, deleteSkill, toggleSkill, attachSkill, setProjectModel,
    } = useProductDetailStore();
    const [createOpen, setCreateOpen] = useState(false);
    const [skillOpen, setSkillOpen] = useState(false);
    const [projectName, setProjectName] = useState("新品详情页");
    const [newProjectPlatform, setNewProjectPlatform] = useState<ProductDetailPlatform>("taobao");
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [storyboardBusy, setStoryboardBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [generatingPageId, setGeneratingPageId] = useState<string>();
    const [generatingAll, setGeneratingAll] = useState(false);
    const [rightTab, setRightTab] = useState("brief");

    useEffect(() => { void load(); }, [load]);

    const activeProject = useMemo(() => workspace.projects.find((project) => project.id === workspace.activeProjectId) || workspace.projects[0], [workspace.activeProjectId, workspace.projects]);
    const activeSkill = useMemo(() => {
        if (!activeProject) return workspace.skills.find((skill) => skill.enabled);
        return workspace.skills.find((skill) => activeProject.skillIds.includes(skill.id) && skill.enabled) || workspace.skills.find((skill) => skill.enabled);
    }, [activeProject, workspace.skills]);
    const attachments = activeProject?.assets.filter((asset) => asset.kind === "product" || asset.kind === "reference") || [];
    const textModels = useMemo(() => selectableModelsByCapability(config, "text").map((value) => ({ value, label: modelOptionName(value) })), [config]);
    const textModelValue = activeProject ? resolveProductDetailTextModel(activeProject, config) : "";

    const create = () => {
        const id = createProject(projectName, newProjectPlatform);
        setCreateOpen(false);
        setRightTab("brief");
        selectProject(id);
    };

    const send = async () => {
        if (!activeProject || !prompt.trim() || busy) return;
        if (!textModelValue) { message.warning("后台创作分组还没有配置文本模型，请先在管理后台添加文本模型。"); return; }
        const userMessage: ProductDetailConversationMessage = { id: nanoid(), role: "user", content: prompt.trim(), createdAt: Date.now() };
        appendMessage(activeProject.id, userMessage);
        setPrompt("");
        setBusy(true);
        try {
            const turn = await requestProductDetailTurn({ ...config, model: textModelValue, textModel: textModelValue }, { brief: activeProject.brief, messages: [...activeProject.messages, userMessage], skill: activeSkill, userMessage: userMessage.content });
            if (turn.briefPatch) updateBrief(activeProject.id, turn.briefPatch);
            if (turn.storyboard) setStoryboard(activeProject.id, turn.storyboard);
            appendMessage(activeProject.id, { id: nanoid(), role: "assistant", content: turn.message, createdAt: Date.now(), turn });
            if (turn.readyToPlan) message.success("信息已经足够，可以生成分镜了");
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
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setUploading(false); }
    };

    const removeAttachment = async (assetId: string) => {
        if (!activeProject) return;
        const asset = activeProject.assets.find((item) => item.id === assetId);
        removeAsset(activeProject.id, assetId);
        if (asset?.storageKey) await deleteStoredImages([asset.storageKey]).catch(() => undefined);
    };
    const createSkillFromProject = () => {
        if (!activeProject) return;
        const id = createSkill(buildSkillCandidate(activeProject));
        attachSkill(activeProject.id, id);
        setSkillOpen(false);
        message.success(t("productDetail.skillCreated"));
    };

    const generatePage = async (page: StoryboardPage) => {
        if (!activeProject) return;
        if (!activeProject.storyboard || activeProject.storyboard.status !== "confirmed") { message.warning(t("productDetail.storyboardRequired")); return; }
        const skill = activeSkill || buildSkillCandidate(activeProject);
        setGeneratingPageId(page.id);
        if (activeProject.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(activeProject.storyboard, page.id, { status: "generating", error: undefined }));
        try {
            const asset = await generateStoryboardImage(config, activeProject, page, skill);
            addAsset(activeProject.id, asset);
            const current = useProductDetailStore.getState().workspace.projects.find((project) => project.id === activeProject.id);
            if (current?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(current.storyboard, page.id, { status: "ready", generatedAssetId: asset.id, error: undefined }));
            message.success(`第 ${page.order} 页底图已生成`);
        } catch (error) {
            const current = useProductDetailStore.getState().workspace.projects.find((project) => project.id === activeProject.id);
            if (current?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(current.storyboard, page.id, { status: "failed", error: error instanceof Error ? error.message : String(error) }));
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setGeneratingPageId(undefined);
        }
    };
    const generateAll = async () => {
        if (!activeProject?.storyboard || activeProject.storyboard.status !== "confirmed") { message.warning(t("productDetail.storyboardRequired")); return; }
        setGeneratingAll(true);
        try {
            for (const page of activeProject.storyboard.pages.filter((item) => !item.generatedAssetId)) {
                await generatePage(page);
            }
        } finally { setGeneratingAll(false); }
    };
    const updatePage = (pageId: string, patch: Partial<StoryboardPage>) => {
        if (activeProject?.storyboard) setStoryboard(activeProject.id, updateStoryboardPage(activeProject.storyboard, pageId, patch));
    };
    const movePage = (pageId: string, offset: number) => {
        if (activeProject?.storyboard) setStoryboard(activeProject.id, reorderStoryboard(activeProject.storyboard, pageId, offset));
    };
    const deletePage = (pageId: string) => {
        if (!activeProject?.storyboard) return;
        const pages = activeProject.storyboard.pages.filter((page) => page.id !== pageId).map((page, index) => ({ ...page, order: index + 1 }));
        setStoryboard(activeProject.id, { ...activeProject.storyboard, revision: activeProject.storyboard.revision + 1, pages });
    };
    const addPage = () => {
        if (!activeProject?.storyboard) return;
        const page = createPage("core-benefit", activeProject.storyboard.pages.length, activeProject.brief, activeSkill || buildSkillCandidate(activeProject));
        setStoryboard(activeProject.id, { ...activeProject.storyboard, revision: activeProject.storyboard.revision + 1, pages: [...activeProject.storyboard.pages, page] });
    };

    const rightTabs = [
        { key: "brief", label: t("productDetail.brief") },
        { key: "storyboard", label: t("productDetail.storyboard") },
        { key: "results", label: t("productDetail.results") },
        { key: "export", label: t("productDetail.export") },
    ];

    return (
        <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <ProjectRail projects={workspace.projects} skills={workspace.skills} activeProjectId={activeProject?.id} onSelect={(id) => { selectProject(id); setRightTab("brief"); }} onCreate={() => setCreateOpen(true)} onDelete={(id) => modal.confirm({ title: t("common.delete"), content: "确定删除这个详情页项目吗？", okText: t("common.delete"), okButtonProps: { danger: true }, cancelText: t("common.cancel"), onOk: () => deleteProject(id) })} onOpenSkills={() => setSkillOpen(true)} />
            {activeProject ? (
                <>
                    <ConversationPanel messages={activeProject.messages} value={prompt} busy={busy} storyboardBusy={storyboardBusy} canPlan={isProductBriefReady(activeProject.brief)} models={textModels} modelValue={textModelValue} attachments={attachments} uploading={uploading} onChange={setPrompt} onModelChange={(model) => setProjectModel(activeProject.id, "text", model)} onUpload={(kind, files) => void uploadAttachments(kind, files)} onRemoveAttachment={(assetId) => void removeAttachment(assetId)} onSend={() => void send()} onGenerateStoryboard={() => void generateStoryboard()} />
                    <aside className="flex min-h-0 w-[430px] shrink-0 flex-col border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950/60">
                        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800"><div className="flex items-center gap-2"><PackageSearch className="size-4 text-orange-500" /><span className="text-sm font-semibold">{activeProject.name}</span><Tag className="m-0">{PLATFORM_OPTIONS.find((item) => item.value === activeProject.platform)?.label}</Tag></div><Button size="small" type="text" icon={<Sparkles className="size-3.5" />} onClick={() => setSkillOpen(true)}>{t("productDetail.skills")}</Button></div>
                        <Tabs activeKey={rightTab} onChange={setRightTab} items={rightTabs} className="px-3 pt-2" />
                        {rightTab === "brief" ? <BriefSummaryPanel brief={activeProject.brief} assets={attachments} /> : null}
                        {rightTab === "storyboard" ? <StoryboardPanel storyboard={activeProject.storyboard} assets={activeProject.assets} generatingPageId={generatingPageId} onUpdate={updatePage} onMove={movePage} onDelete={deletePage} onAdd={addPage} onConfirm={() => confirmStoryboard(activeProject.id)} onGenerate={generatePage} onGenerateAll={generateAll} generatingAll={generatingAll} /> : null}
                        {rightTab === "results" ? <RenderPreview project={activeProject} platform={activeProject.platform} skill={activeSkill || buildSkillCandidate(activeProject)} onGenerateImage={generatePage} /> : null}
                        {rightTab === "export" ? <RenderPreview project={activeProject} platform={activeProject.platform} skill={activeSkill || buildSkillCandidate(activeProject)} onGenerateImage={generatePage} /> : null}
                    </aside>
                </>
            ) : (
                <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 text-center dark:bg-stone-950"><div className="flex size-16 items-center justify-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><PackageSearch className="size-7" /></div><h1 className="mt-5 text-xl font-semibold">{t("productDetail.title")}</h1><p className="mt-2 max-w-md text-sm leading-6 text-stone-500">{t("productDetail.emptyProjectsHint")}</p><Button type="primary" icon={<Plus className="size-4" />} className="mt-5" onClick={() => setCreateOpen(true)}>{t("productDetail.newProject")}</Button></main>
            )}
            <Modal title={t("productDetail.newProject")} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} okText="创建" cancelText={t("common.cancel")}><div className="space-y-4 pt-2"><div><div className="mb-1 text-xs text-stone-500">{t("productDetail.projectName")}</div><Input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></div><div><div className="mb-1 text-xs text-stone-500">{t("productDetail.platform")}</div><Select className="w-full" value={newProjectPlatform} options={PLATFORM_OPTIONS} onChange={setNewProjectPlatform} /></div></div></Modal>
            <SkillManagerModal open={skillOpen} skills={workspace.skills} canCreate={Boolean(activeProject)} onClose={() => setSkillOpen(false)} onToggle={toggleSkill} onDelete={(id) => deleteSkill(id)} onCreateFromProject={createSkillFromProject} onAttach={(skillId) => { if (activeProject) attachSkill(activeProject.id, skillId); }} />
        </div>
    );
}
