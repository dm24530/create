import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ImagePlus, MessageSquareText, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "antd";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { DetailImagePreview } from "@/components/product-detail/detail-image-preview";
import type { ProductCopyBlock, ProductDetailAsset, ProductPageRole, Storyboard, StoryboardPage } from "@/types/product-detail";

const ROLE_LABELS: Record<ProductPageRole, string> = {
    hero: "首屏", "pain-point": "痛点", "core-benefit": "利益", "feature-detail": "细节", scenario: "场景", "how-to-use": "步骤", specification: "规格", trust: "信任", closing: "收尾",
};

export function StoryboardPanel({ storyboard, assets, stale, imageModelAvailable, generatingPageIds, onMove, onDelete, onConfirm, onGenerate, onGenerateAll, onRegenerate, onKeepEditing, generatingAll, onRequestChange, onUpdatePage }: {
    storyboard?: Storyboard;
    assets: ProductDetailAsset[];
    stale: boolean;
    imageModelAvailable: boolean;
    generatingPageIds: string[];
    onMove: (pageId: string, offset: number) => void;
    onDelete: (pageId: string) => void;
    onConfirm: () => void;
    onGenerate: (page: StoryboardPage) => Promise<void>;
    onGenerateAll: () => Promise<void>;
    onRegenerate: () => void;
    onKeepEditing: () => void;
    generatingAll: boolean;
    onRequestChange: (request: string) => void;
    onUpdatePage: (pageId: string, patch: Pick<StoryboardPage, "title" | "message" | "copy">) => void;
}) {
    const { t } = useTranslation();
    const [editingPage, setEditingPage] = useState<StoryboardPage | null>(null);
    const [draft, setDraft] = useState({ eyebrow: "", title: "", body: "", specs: "", cta: "" });
    useEffect(() => {
        if (!editingPage) return;
        const copyText = (kind: ProductCopyBlock["kind"]) => editingPage.copy.find((item) => item.kind === kind)?.text || "";
        setDraft({
            eyebrow: copyText("eyebrow"),
            title: copyText("title") || editingPage.title,
            body: copyText("body") || editingPage.message,
            specs: editingPage.copy.filter((item) => item.kind === "spec").map((item) => item.text).join("\n"),
            cta: copyText("cta"),
        });
    }, [editingPage]);
    const openEditor = (page: StoryboardPage) => setEditingPage(page);
    const saveEditor = () => {
        if (!editingPage) return;
        const copy = replaceCopyBlocks(editingPage.copy, draft);
        onUpdatePage(editingPage.id, { title: draft.title.trim() || editingPage.title, message: draft.body.trim() || editingPage.message, copy });
        setEditingPage(null);
    };
    if (!storyboard) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <MessageSquareText className="mb-3 size-7 text-stone-300 dark:text-stone-600" />
                <div className="text-sm font-medium text-stone-500 dark:text-stone-400">{t("productDetail.noStoryboard")}</div>
                <div className="mt-2 max-w-xs text-[11px] leading-5 text-stone-400 dark:text-stone-500">在左侧对话里说“生成分镜”，或补充商品信息后让 Agent 继续。</div>
            </div>
        );
    }

    const confirmed = storyboard.status === "confirmed" && !stale && !storyboard.warning;
    const canConfirm = !stale && !storyboard.warning && storyboard.pages.length > 0;
    const canGenerate = confirmed && imageModelAvailable;

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
            <div className="rounded-[18px] border border-black/[0.07] bg-white/70 p-4 shadow-[0_4px_16px_rgba(38,32,25,0.025)] dark:border-white/[0.08] dark:bg-white/[0.035]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${stale ? "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300" : confirmed ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                            <span className={`size-1.5 rounded-full ${stale ? "bg-amber-500" : confirmed ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {stale ? "待更新" : confirmed ? "已确认" : "待确认"}
                        </span>
                        <span className="text-[10px] text-stone-400">Rev {storyboard.revision} · {storyboard.pages.length} 页</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="small" icon={<MessageSquareText className="size-3.5" />} onClick={() => onRequestChange("请调整当前分镜结构：新增一页，并说明放在哪个位置，页面文案和视觉方向是什么。")} className="h-8 rounded-full border-black/[0.08] bg-white px-3 text-[10px] shadow-none dark:border-white/10 dark:bg-transparent">对话新增</Button>
                        {stale || storyboard.warning ? <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRegenerate} className="h-8 rounded-full border-black/[0.08] bg-white px-3 text-[10px] shadow-none dark:border-white/10 dark:bg-transparent">{stale ? "AI 更新分镜" : "重新生成"}</Button> : null}
                        {stale ? <Button size="small" icon={<Pencil className="size-3.5" />} onClick={onKeepEditing} className="h-8 rounded-full border-black/[0.08] bg-white px-3 text-[10px] shadow-none dark:border-white/10 dark:bg-transparent">保留并继续编辑</Button> : null}
                        {confirmed ? (
                            <Button size="small" icon={<ImagePlus className="size-3.5" />} loading={generatingAll} disabled={!canGenerate} onClick={() => void onGenerateAll()} className="h-8 rounded-full border-0 bg-[#22211f] px-3 text-[10px] font-semibold text-white shadow-none hover:!bg-black dark:!bg-stone-100 dark:!text-stone-950 dark:hover:!bg-white dark:hover:!text-stone-950">生成全部底图</Button>
                        ) : (
                            <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} disabled={!canConfirm} onClick={onConfirm} className="h-8 rounded-full border-0 bg-[#22211f] px-3 text-[10px] font-semibold text-white shadow-none hover:!bg-black dark:!bg-stone-100 dark:!text-stone-950 dark:hover:!bg-white dark:hover:!text-stone-950">确认分镜</Button>
                        )}
                    </div>
                </div>
                <div className="mt-3 text-[10px] leading-5 text-stone-400 dark:text-stone-500">确认分镜本身不扣生图费用；确认后再点击“生成全部底图”才会开始计费。</div>
                {stale ? <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-[10px] leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />商品信息已更新。你可以保留当前分镜继续编辑，或让 AI 基于现有内容更新分镜；确认前不会生成新图片。</div> : null}
                {storyboard.warning && !stale ? <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200/70 bg-red-50/70 px-3 py-2.5 text-[10px] leading-5 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{storyboard.warning}。为避免错误费用，当前分镜不能确认或生图。</div> : null}
                {!imageModelAvailable ? <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-[10px] leading-5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />后台创作分组没有配置生图模型，暂时不能生成底图。</div> : null}
            </div>

            <div className="mt-3 space-y-2.5">
                {storyboard.pages.map((page, index) => {
                    const asset = page.generatedAssetId ? assets.find((item) => item.id === page.generatedAssetId) : undefined;
                    const generating = generatingPageIds.includes(page.id) || page.status === "generating";
                    const referenceAssets = page.referenceAssetIds.map((id) => assets.find((item) => item.id === id)).filter(Boolean).slice(0, 4) as ProductDetailAsset[];
                    const specTexts = page.copy.filter((item) => item.kind === "spec").map((item) => item.text).filter(Boolean);
                    const ctaText = page.copy.find((item) => item.kind === "cta")?.text || "";
                    return (
                        <div key={page.id} className="rounded-[16px] border border-black/[0.06] bg-white/70 p-3.5 shadow-[0_2px_10px_rgba(38,32,25,0.02)] transition hover:border-black/[0.1] dark:border-white/[0.07] dark:bg-white/[0.035] dark:hover:border-white/[0.12]">
                            <div className="mb-3 flex items-center gap-2">
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9px] font-medium text-stone-600 dark:bg-white/[0.06] dark:text-stone-300">{ROLE_LABELS[page.role]}</span>
                                <span className="min-w-0 flex-1" />
                                {confirmed && !page.generatedAssetId ? <Button size="small" type="text" icon={<ImagePlus className="size-3.5" />} loading={generating} disabled={!canGenerate} onClick={() => void onGenerate(page)} className="size-7 rounded-lg text-stone-500" /> : null}
                                <Button size="small" type="text" disabled={index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(page.id, -1)} className="size-7 rounded-lg text-stone-400" />
                                <Button size="small" type="text" disabled={index === storyboard.pages.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(page.id, 1)} className="size-7 rounded-lg text-stone-400" />
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(page.id)} className="size-7 rounded-lg" />
                            </div>
                            <div className="text-[13px] font-semibold tracking-[-0.015em] text-stone-900 dark:text-stone-100">{page.title}</div>
                            <div className="mt-1 text-[11px] leading-5 text-stone-500 dark:text-stone-400">{page.message}</div>
                            {specTexts.length ? <div className="mt-2 space-y-1 rounded-xl bg-stone-50/75 px-3 py-2 dark:bg-white/[0.03]">{specTexts.slice(0, 6).map((text, specIndex) => <div key={`${text}-${specIndex}`} className="flex items-start gap-2 text-[10px] leading-5 text-stone-600 dark:text-stone-300"><span className="mt-2 size-1 shrink-0 rounded-full bg-emerald-500" /><span>{text}</span></div>)}</div> : null}
                            {ctaText ? <div className="mt-2 inline-flex rounded-full bg-[#22211f] px-3 py-1 text-[10px] font-medium text-white dark:bg-stone-100 dark:text-stone-950">{ctaText}</div> : null}
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEditor(page)} className="h-7 rounded-full border-black/[0.08] px-2.5 text-[9px] dark:border-white/10">编辑文案</Button>
                                <Button size="small" type="dashed" icon={<MessageSquareText className="size-3.5" />} onClick={() => onRequestChange(`请修改分镜“${page.title}”：`)} className="h-7 rounded-full border-black/[0.08] px-2.5 text-[9px] dark:border-white/10">让 AI 修改</Button>
                                <span className={`rounded-full px-2 py-1 text-[9px] ${stale && page.generatedAssetId ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-300" : page.status === "ready" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300" : page.status === "failed" ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-300" : "bg-stone-100 text-stone-500 dark:bg-white/[0.06] dark:text-stone-400"}`}>
                                    {stale && page.generatedAssetId ? "底图需重新生成" : page.status === "ready" ? "底图已生成" : page.status === "failed" ? "生成失败" : generating ? "生成中" : "待生成"}
                                </span>
                                {page.factRefs.length ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">事实引用 {page.factRefs.length}</span> : null}
                            </div>
                            {page.error ? <div className="mt-2 rounded-xl bg-red-50/80 px-3 py-2 text-[10px] leading-5 text-red-600 dark:bg-red-950/20 dark:text-red-300">{page.error}</div> : null}
                            {asset?.url ? <div className="mt-3 h-24 overflow-hidden rounded-xl bg-stone-100 dark:bg-stone-800"><DetailImagePreview src={asset.url} alt={page.title} classNames={{ root: "!block h-full w-full cursor-zoom-in", image: "h-full w-full object-cover" }} previewCover={<span className="text-[10px] font-medium">点击放大</span>} /></div> : null}
                            {referenceAssets.length ? <div className="mt-2 flex gap-1.5">{referenceAssets.map((reference) => <div key={reference.id} className="size-10 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">{reference.url ? <DetailImagePreview src={reference.url} alt={reference.name} width={40} height={40} classNames={{ root: "!block cursor-zoom-in", image: "object-cover" }} /> : null}</div>)}</div> : null}
                            <details className="mt-2 rounded-xl bg-stone-50/80 px-3 py-2 text-[10px] leading-5 text-stone-500 dark:bg-white/[0.03] dark:text-stone-400">
                                <summary className="cursor-pointer select-none font-medium">查看视觉提示词</summary>
                                <div className="mt-1.5 whitespace-pre-wrap">{page.visualPrompt}</div>
                                {page.negativePrompt.length ? <div className="mt-1.5">禁用：{page.negativePrompt.join("、")}</div> : null}
                            </details>
                        </div>
                    );
                })}
            </div>
            <Button block type="dashed" icon={<Plus className="size-3.5" />} className="mt-3 h-9 rounded-[14px] border-black/[0.08] text-[10px] dark:border-white/10" onClick={() => onRequestChange("请在当前分镜中新增一页，并直接给出完整的新分镜。")}>通过对话新增一页</Button>

            <Modal
                open={Boolean(editingPage)}
                centered
                width={680}
                title="编辑本页文案"
                okText="保存并重新确认"
                cancelText="取消"
                onOk={saveEditor}
                onCancel={() => setEditingPage(null)}
            >
                <div className="space-y-3 pt-2">
                    <Field label="眉题"><Input value={draft.eyebrow} onChange={(event) => setDraft((current) => ({ ...current, eyebrow: event.target.value }))} /></Field>
                    <Field label="标题"><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></Field>
                    <Field label="正文"><Input.TextArea value={draft.body} autoSize={{ minRows: 3, maxRows: 7 }} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} /></Field>
                    <Field label="规格 / 要点（每行一条）"><Input.TextArea value={draft.specs} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => setDraft((current) => ({ ...current, specs: event.target.value }))} /></Field>
                    <Field label="按钮文案"><Input value={draft.cta} onChange={(event) => setDraft((current) => ({ ...current, cta: event.target.value }))} /></Field>
                    <div className="text-[10px] leading-5 text-stone-500 dark:text-stone-400">保存后分镜会回到待确认状态，需要再次确认才会生成底图。</div>
                </div>
            </Modal>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-[11px] font-medium text-stone-600 dark:text-stone-300">{label}</span>{children}</label>;
}

function replaceCopyBlocks(current: ProductCopyBlock[], draft: { eyebrow: string; title: string; body: string; specs: string; cta: string }): ProductCopyBlock[] {
    const result: ProductCopyBlock[] = [];
    const upsert = (kind: ProductCopyBlock["kind"], text: string) => {
        const value = text.trim();
        if (!value) return;
        const existing = current.find((item) => item.kind === kind);
        result.push({ id: existing?.id || nanoid(), kind, text: value });
    };
    upsert("eyebrow", draft.eyebrow);
    upsert("title", draft.title);
    upsert("body", draft.body);
    draft.specs.split(/\n+/).map((item) => item.trim()).filter(Boolean).forEach((text, index) => {
        const existing = current.filter((item) => item.kind === "spec")[index];
        result.push({ id: existing?.id || nanoid(), kind: "spec", text });
    });
    upsert("cta", draft.cta);
    return result;
}
