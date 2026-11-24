import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, ChevronDown, Eye, ImagePlus, MessageSquareText, Paperclip, PanelRight, Sparkles, Upload, X } from "lucide-react";
import { Button, Dropdown, Input, Modal, Select, Spin, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useTranslation } from "react-i18next";

import { isProductBriefReady, questionAllowsMultiple, missingProductBriefFields } from "@/lib/product-detail/brief";
import { imageFilesFromClipboardData } from "@/lib/product-detail/clipboard-images";
import { DetailImagePreview } from "@/components/product-detail/detail-image-preview";
import { formatDetailText } from "@/lib/product-detail/conversation";
import type { ProductBrief, ProductBriefPatch, ProductDetailAgentAction, ProductDetailAsset, ProductDetailConversationMessage, Storyboard } from "@/types/product-detail";

export type ProductDetailOperation = {
    kind: "thinking" | "storyboard" | "images";
    startedAt: number;
    label?: string;
};

export function ConversationPanel({
    messages,
    value,
    busy,
    storyboardBusy,
    canPlan,
    storyboard,
    storyboardStale,
    projectName,
    projectStatus,
    brief,
    detailsOpen,
    models,
    modelValue,
    imageModels,
    imageModelValue,
    attachments,
    allAssets,
    uploading,
    operation,
    showGenerationConfirmation,
    onConfirmGeneration,
    onContinueEditing,
    onSupplement,
    onToggleDetails,
    focusToken,
    onChange,
    onModelChange,
    onImageModelChange,
    onUpload,
    onRemoveAttachment,
    onSend,
    onGenerateStoryboard,
    onOpenStoryboard,
    onQuickReply,
    onAction,
}: {
    messages: ProductDetailConversationMessage[];
    value: string;
    busy: boolean;
    storyboardBusy: boolean;
    canPlan: boolean;
    storyboard?: Storyboard;
    storyboardStale: boolean;
    projectName: string;
    projectStatus: string;
    brief: ProductBrief;
    detailsOpen: boolean;
    models: Array<{ value: string; label: string }>;
    modelValue: string;
    imageModels: Array<{ value: string; label: string }>;
    imageModelValue: string;
    attachments: ProductDetailAsset[];
    allAssets: ProductDetailAsset[];
    uploading: boolean;
    operation: ProductDetailOperation | null;
    showGenerationConfirmation: boolean;
    onConfirmGeneration: () => void;
    onContinueEditing: () => void;
    onSupplement: (text: string) => void;
    onToggleDetails: () => void;
    focusToken: number;
    onChange: (value: string) => void;
    onModelChange: (value: string) => void;
    onImageModelChange: (value: string) => void;
    onUpload: (kind: "product" | "reference", files: FileList | File[] | null) => void;
    onRemoveAttachment: (assetId: string) => void;
    onSend: () => void;
    onGenerateStoryboard: () => void;
    onOpenStoryboard: () => void;
    onQuickReply: (text: string) => void;
    onAction: (action: ProductDetailAgentAction, message: ProductDetailConversationMessage) => void;
}) {
    const { t } = useTranslation();
    const productInputRef = useRef<HTMLInputElement>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<TextAreaRef>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);
    const hasTextModel = models.length > 0 && Boolean(modelValue);
    const hasImageModel = imageModels.length > 0 && Boolean(imageModelValue);
    const hasUserMessage = messages.some((message) => message.role === "user");
    const latestAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;
    const visibleMessages = useMemo(
        () => !hasUserMessage && messages.length <= 1 ? [] : messages,
        [hasUserMessage, messages],
    );

    useEffect(() => {
        if (focusToken > 0) requestAnimationFrame(() => textareaRef.current?.focus());
    }, [focusToken]);

    useEffect(() => { setConfirmationModalOpen(false); }, [projectName]);

    const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
        const container = scrollRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
    };

    useEffect(() => {
        stickToBottomRef.current = true;
        const frame = requestAnimationFrame(() => scrollToBottom(messages.length > 2 ? "smooth" : "auto"));
        const timeout = window.setTimeout(() => scrollToBottom("auto"), 180);
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(timeout);
        };
    }, [messages.length, busy, operation?.kind]);

    useEffect(() => {
        const container = scrollRef.current;
        const content = container?.firstElementChild;
        if (!container || !content) return;
        const observer = new ResizeObserver(() => {
            if (stickToBottomRef.current) scrollToBottom("auto");
        });
        observer.observe(container);
        observer.observe(content);
        return () => observer.disconnect();
    }, []);

    const focusComposerWith = (text: string) => {
        onChange(text);
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const hasCurrentStoryboard = Boolean(storyboard?.pages.length && !storyboardStale);
    const storyboardNeedsRegenerate = Boolean(storyboard && storyboardStale);
    const storyboardButtonLabel = hasCurrentStoryboard ? "查看分镜" : storyboardNeedsRegenerate ? "重新生成分镜" : "生成分镜";
    const storyboardButtonIcon = hasCurrentStoryboard ? <Eye className="size-3.5" /> : <Sparkles className="size-3.5" />;
    const storyboardButtonDisabled = hasCurrentStoryboard ? false : !canPlan || busy || !hasTextModel;
    const handleStoryboardButton = hasCurrentStoryboard ? onOpenStoryboard : onGenerateStoryboard;

    return (
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#f7f6f2] text-[#22211f] dark:bg-[#151412] dark:text-stone-100">
            <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-black/[0.06] bg-[#f7f6f2]/92 px-5 backdrop-blur-xl dark:border-white/[0.07] dark:bg-[#151412]/92 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[13px] bg-[#22211f] text-white shadow-[0_6px_18px_rgba(34,33,31,0.16)] dark:bg-stone-100 dark:text-stone-950">
                        <Sparkles className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold tracking-[-0.025em]">{projectName}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            <span>{projectStatus}</span>
                            <span className="text-stone-300 dark:text-stone-700">/</span>
                            <span>AI 商品设计顾问</span>
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        icon={<PanelRight className="size-4" />}
                        className="h-9 rounded-full border-black/[0.08] bg-white/70 px-3.5 text-xs font-medium text-stone-700 shadow-none hover:border-black/15 hover:bg-white hover:text-stone-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                        onClick={onToggleDetails}
                    >
                        {detailsOpen ? "收起工作区" : "项目工作区"}
                    </Button>
                    <Button
                        icon={storyboardButtonIcon}
                        loading={!hasCurrentStoryboard && storyboardBusy}
                        disabled={storyboardButtonDisabled}
                        onClick={handleStoryboardButton}
                        className="h-9 rounded-full border-0 bg-[#22211f] px-4 text-xs font-semibold text-white shadow-[0_6px_20px_rgba(34,33,31,0.16)] hover:bg-black dark:!bg-stone-100 dark:!text-stone-950 dark:hover:bg-white dark:hover:!text-stone-950"
                    >
                        {storyboardButtonLabel}
                    </Button>
                </div>
            </header>

            <div ref={scrollRef} onScroll={(event) => { const element = event.currentTarget; stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col px-5 pb-7 pt-7 sm:px-8 sm:pt-10">
                    {!hasUserMessage ? (
                        <ConversationLanding
                            onUploadProduct={() => productInputRef.current?.click()}
                            onUploadReference={() => referenceInputRef.current?.click()}
                            onPrompt={focusComposerWith}
                        />
                    ) : null}

                    <div className="space-y-8">
                        {visibleMessages.map((message) => (
                            <MessageRow
                                key={message.id}
                                message={message}
                                isLatestAssistant={message.id === latestAssistantId}
                                showGenerationConfirmation={showGenerationConfirmation}
                                busy={busy}
                                hasTextModel={hasTextModel}
                                allAssets={allAssets}
                                canRequestNextStep={message.id === latestAssistantId}
                                onQuickReply={onQuickReply}
                                onRequestNextStep={() => setConfirmationModalOpen(true)}
                                onAction={(action, actionMessage) => {
                                    if (action.type === "plan_storyboard") {
                                        setConfirmationModalOpen(true);
                                        return;
                                    }
                                    onAction(action, actionMessage);
                                }}
                            />
                        ))}
                    </div>

                    <OperationProgress operation={operation} />
                    <div ref={endRef} />
                </div>
            </div>            <div className="shrink-0 border-t border-black/[0.05] bg-[#f7f6f2]/94 px-4 pb-4 pt-3 backdrop-blur-xl dark:border-white/[0.07] dark:bg-[#151412]/94 sm:px-6 sm:pb-5">
                <div className="relative mx-auto w-full max-w-[900px]">
                    {!hasTextModel ? (
                        <div className="mb-2.5 flex items-start gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-2.5 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            <span>后台创作分组还没有可用的文本模型。添加后这里会自动出现，不需要用户手动配置。</span>
                        </div>
                    ) : null}

                    {attachments.length ? (
                        <div data-composer-attachments="" className="pointer-events-none absolute inset-x-3 bottom-full z-30 mb-2 flex justify-start">
                            <div className="thin-scrollbar pointer-events-auto flex max-w-full gap-2 overflow-x-auto rounded-2xl border border-black/[0.08] bg-white/96 p-2 shadow-[0_12px_36px_rgba(38,32,25,0.16)] backdrop-blur-xl dark:border-white/[0.1] dark:bg-[#25231f]/98">
                                {attachments.map((asset) => (
                                    <div key={asset.id} className="group relative size-[58px] shrink-0 overflow-hidden rounded-[14px] bg-stone-100 dark:bg-stone-800">
                                        {asset.url ? <DetailImagePreview src={asset.url} alt={asset.name} classNames={{ root: "!block h-full w-full cursor-zoom-in", image: "h-full w-full object-cover" }} previewCover={false} /> : null}
                                        <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded-md bg-black/65 px-1.5 py-0.5 text-[8px] font-medium text-white">{asset.kind === "product" ? "商品图" : "参考图"}</span>
                                        <Tooltip title="移除">
                                            <button
                                                type="button"
                                                data-remove-attachment={asset.id}
                                                aria-label={`移除${asset.name}`}
                                                className="absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow-sm transition hover:bg-black group-hover:opacity-100"
                                                onClick={(event) => { event.stopPropagation(); onRemoveAttachment(asset.id); }}
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </Tooltip>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div data-product-detail-composer="" className="product-detail-composer overflow-hidden rounded-[26px] border border-black/[0.09] bg-white shadow-[0_18px_50px_rgba(38,32,25,0.08)] transition focus-within:border-black/20 focus-within:shadow-[0_20px_60px_rgba(38,32,25,0.11)] dark:border-white/10 dark:bg-[#211f1c] dark:focus-within:border-white/20">
                        <Input.TextArea
                            ref={textareaRef}
                            value={value}
                            onChange={(event) => onChange(event.target.value)}
                            placeholder="描述商品、人群和卖点；也可以先上传商品图或参考图，直接发送让我先分析…"
                            autoSize={{ minRows: 3, maxRows: 9 }}
                            variant="borderless"
                            className="!px-5 !pt-4 !text-[15px] !leading-7 !text-[#22211f] placeholder:!text-stone-400 dark:!text-stone-100 dark:placeholder:!text-stone-500"
                            onPaste={(event) => {
                                const files = imageFilesFromClipboardData(event.clipboardData);
                                if (files.length) {
                                    event.preventDefault();
                                    onUpload("product", files);
                                }
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    if ((value.trim() || attachments.length) && !busy && !uploading && hasTextModel) onSend();
                                }
                            }}
                        />

                        <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1.5 sm:px-4">
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        { key: "product", label: "上传商品图", icon: <ImagePlus className="size-3.5" /> },
                                        { key: "reference", label: "上传参考详情页 / 参考图", icon: <Upload className="size-3.5" /> },
                                    ],
                                    onClick: ({ key }) => (key === "product" ? productInputRef.current?.click() : referenceInputRef.current?.click()),
                                }}
                            >
                                <Button
                                    type="text"
                                    icon={<Paperclip className="size-4" />}
                                    loading={uploading}
                                    className="size-9 rounded-full border border-black/[0.07] bg-stone-50 text-stone-600 hover:!bg-stone-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-300 dark:hover:!bg-white/[0.08]"
                                />
                            </Dropdown>

                            <div className="flex min-w-0 items-center gap-1 rounded-full border border-black/[0.06] bg-stone-50 px-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
                                <Select
                                    size="small"
                                    variant="borderless"
                                    value={modelValue || undefined}
                                    options={models}
                                    placeholder={models.length ? "策划模型" : "等待文本模型"}
                                    showSearch
                                    optionFilterProp="label"
                                    popupMatchSelectWidth={false}
                                    suffixIcon={<ChevronDown className="size-3.5" />}
                                    className="max-w-[178px] text-xs"
                                    disabled={!models.length}
                                    onChange={onModelChange}
                                />
                                <span className="size-1 rounded-full bg-stone-300 dark:bg-stone-600" />
                                <Select
                                    size="small"
                                    variant="borderless"
                                    value={imageModelValue || undefined}
                                    options={imageModels}
                                    placeholder={imageModels.length ? "生图模型" : "等待生图模型"}
                                    showSearch
                                    optionFilterProp="label"
                                    popupMatchSelectWidth={false}
                                    suffixIcon={<ChevronDown className="size-3.5" />}
                                    className="max-w-[178px] text-xs"
                                    disabled={!imageModels.length}
                                    onChange={onImageModelChange}
                                />
                            </div>

                            {!hasImageModel ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/25 dark:text-amber-300">生图模型待配置</span> : null}
                            <span className="hidden text-[10px] text-stone-400 sm:inline">模型由后台创作分组提供</span>

                            <div className="ml-auto flex items-center gap-2">
                                <span className="hidden text-[10px] text-stone-400 sm:inline">{uploading ? "正在处理图片…" : "Enter 发送 · Shift + Enter 换行"}</span>
                                <Button
                                    type="primary"
                                    shape="circle"
                                    icon={<ArrowUp className="size-4.5" />}
                                    loading={busy}
                                    disabled={(!value.trim() && !attachments.length) || !hasTextModel || uploading}
                                    onClick={onSend}
                                    className="size-10 border-0 bg-[#22211f] shadow-[0_6px_18px_rgba(34,33,31,0.2)] hover:!bg-black dark:bg-emerald-600 dark:hover:!bg-emerald-500"
                                    aria-label={t("productDetail.send")}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between px-2 text-[10px] text-stone-400 dark:text-stone-500">
                        <span>AI 会根据对话持续整理信息，重要参数请在生成前检查。</span>
                        <span className="hidden sm:inline">仅使用你的创作分组</span>
                    </div>

                    <input ref={productInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { onUpload("product", event.target.files); event.target.value = ""; }} />
                    <input ref={referenceInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { onUpload("reference", event.target.files); event.target.value = ""; }} />
                </div>
            </div>
            <BriefGenerationConfirmation
                open={showGenerationConfirmation || confirmationModalOpen}
                brief={brief}
                onConfirm={() => { setConfirmationModalOpen(false); onConfirmGeneration(); }}
                onContinue={() => { setConfirmationModalOpen(false); onContinueEditing(); }}
                onSupplement={(text) => { setConfirmationModalOpen(false); onSupplement(text); }}
                onOpenDetails={onToggleDetails}
            />
        </section>
    );
}

function ConversationLanding({ onUploadProduct, onUploadReference, onPrompt }: {
    onUploadProduct: () => void;
    onUploadReference: () => void;
    onPrompt: (text: string) => void;
}) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center pb-14 pt-8 text-center sm:pb-20 sm:pt-14">
            <div className="flex size-14 items-center justify-center rounded-[20px] bg-[#22211f] text-white shadow-[0_16px_40px_rgba(34,33,31,0.18)] dark:bg-stone-100 dark:text-stone-950">
                <Sparkles className="size-6" />
            </div>
            <h1 className="mt-6 max-w-2xl text-3xl font-semibold tracking-[-0.055em] text-[#22211f] dark:text-stone-50 sm:text-[42px] sm:leading-[1.1]">
                把商品想法，变成一张好详情页
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-stone-500 dark:text-stone-400">
                上传商品图和参考图后可以直接发送。我会先分析图片中的商品、配色、材质和版式，再只追问缺失信息；确认后才进入分镜和生图。
            </p>
            <div className="mt-7 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-3">
                <LandingAction icon={<ImagePlus className="size-4" />} title="上传商品图" description="从真实商品开始" onClick={onUploadProduct} />
                <LandingAction icon={<Upload className="size-4" />} title="导入参考图" description="作为视觉分析依据" onClick={onUploadReference} />
                <LandingAction icon={<MessageSquareText className="size-4" />} title="描述产品卖点" description="先说想法也可以" onClick={() => onPrompt("我想做一款商品的详情页，商品是：")} />
            </div>
            <div className="mt-8 text-[11px] text-stone-400 dark:text-stone-500">支持淘宝、天猫、京东、拼多多 · 生成前会再次确认</div>
        </div>
    );
}

function LandingAction({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="group flex items-center gap-3 rounded-[18px] border border-black/[0.07] bg-white/75 px-4 py-3.5 text-left shadow-[0_1px_1px_rgba(38,32,25,0.03)] transition hover:-translate-y-0.5 hover:border-black/[0.13] hover:bg-white hover:shadow-[0_12px_28px_rgba(38,32,25,0.07)] dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:border-white/15 dark:hover:bg-white/[0.06]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 transition group-hover:bg-[#22211f] group-hover:text-white dark:bg-white/[0.06] dark:text-stone-300 dark:group-hover:bg-stone-100 dark:group-hover:text-stone-950">{icon}</span>
        <span className="min-w-0"><span className="block text-xs font-semibold text-stone-800 dark:text-stone-200">{title}</span><span className="mt-0.5 block text-[10px] text-stone-400">{description}</span></span>
    </button>
    );
}

export function MessageRow({ message, isLatestAssistant, showGenerationConfirmation, busy, hasTextModel, allAssets, canRequestNextStep, onQuickReply, onRequestNextStep, onAction }: {
    message: ProductDetailConversationMessage;
    isLatestAssistant: boolean;
    showGenerationConfirmation: boolean;
    busy: boolean;
    hasTextModel: boolean;
    allAssets: ProductDetailAsset[];
    canRequestNextStep: boolean;
    onQuickReply: (text: string) => void;
    onRequestNextStep: () => void;
    onAction: (action: ProductDetailAgentAction, message: ProductDetailConversationMessage) => void;
}) {
    const question = isLatestAssistant && !showGenerationConfirmation ? message.turn?.question : undefined;
    const questionOptions = question?.options;
    const actions = isLatestAssistant ? message.turn?.actions : undefined;
    const multipleOptions = question ? questionAllowsMultiple(question) : false;
    const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
    useEffect(() => { setSelectedOptions([]); }, [message.id, question?.prompt, questionOptions?.join("\u0000")]);
    const toggleOption = (option: string) => {
        setSelectedOptions((current) => {
            if (!multipleOptions) return [option];
            return current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
        });
    };
    const submitOptions = () => {
        if (!selectedOptions.length) return;
        onQuickReply(selectedOptions.join("；"));
        setSelectedOptions([]);
    };

    if (message.role === "user") {
        return (
            <div className="flex justify-end">
                <div className="max-w-[82%] sm:max-w-[72%]">
                    <div data-user-message-bubble="" className="rounded-[24px] rounded-br-[8px] bg-[#22211f] px-5 py-3.5 text-[14px] leading-7 text-white shadow-[0_8px_24px_rgba(34,33,31,0.12)] dark:border dark:border-white/[0.09] dark:bg-[#2b2926] dark:text-stone-100 dark:shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        {message.assetIds?.length ? <MessageAttachments assetIds={message.assetIds} allAssets={allAssets} light /> : null}
                    </div>
                    <div className="mt-1.5 pr-1 text-right text-[10px] text-stone-400">{formatMessageTime(message.createdAt)}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="group flex items-start justify-start">
            <div className="min-w-0 max-w-[90%]">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold tracking-[-0.02em] text-stone-900 dark:text-stone-100">Create 设计助手</span>
                    <span className="text-[10px] text-stone-400">{formatMessageTime(message.createdAt)}</span>
                </div>
                <div className="mt-2 text-[14px] leading-7 text-[#34312d] dark:text-stone-300">
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    {message.error ? <div className="mt-3 rounded-2xl border border-red-200/70 bg-red-50/80 px-3.5 py-2.5 text-xs leading-5 text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{message.error}</div> : null}
                </div>
                {message.assetIds?.length ? <MessageAttachments assetIds={message.assetIds} allAssets={allAssets} /> : null}
                {message.turn ? <AssistantDetails turn={message.turn} defaultOpen={isLatestAssistant} canRequestNextStep={canRequestNextStep} onRequestNextStep={onRequestNextStep} /> : null}
                {!showGenerationConfirmation && message.turn?.question?.prompt && message.turn.question.prompt.trim() !== message.content.trim() ? (
                    <div className="mt-3 text-xs font-medium text-stone-600 dark:text-stone-300">{message.turn.question.prompt}</div>
                ) : null}
                {questionOptions?.length ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {questionOptions.map((option) => {
                            const selected = selectedOptions.includes(option);
                            return (
                                <button key={option} type="button" aria-pressed={selected} disabled={busy || !hasTextModel} onClick={() => toggleOption(option)} className={`rounded-full border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-stone-900 bg-stone-900 font-medium text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950" : "border-black/[0.09] bg-white/70 text-stone-600 hover:border-black/20 hover:bg-white hover:text-stone-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-300 dark:hover:border-white/20 dark:hover:bg-white/[0.08] dark:hover:text-white"}`}>
                                    {selected ? "✓ " : ""}{option}
                                </button>
                            );
                        })}
                        {selectedOptions.length ? (
                            <button type="button" disabled={busy || !hasTextModel} onClick={submitOptions} className="rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
                                发送选择
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {actions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {actions.map((action, index) => (
                            <Button key={`${action.type}-${index}`} size="small" disabled={busy} onClick={() => onAction(action, message)} className="h-8 rounded-full border-black/[0.1] bg-white px-3 text-[11px] font-medium text-stone-700 shadow-none hover:border-black/20 hover:text-stone-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-300">
                                {action.label || actionLabel(action.type)}
                            </Button>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function MessageAttachments({ assetIds, allAssets, light = false }: { assetIds: string[]; allAssets: ProductDetailAsset[]; light?: boolean }) {
    const items = assetIds.map((assetId) => allAssets.find((asset) => asset.id === assetId)).filter((asset): asset is ProductDetailAsset => Boolean(asset));
    if (!items.length) return null;
    return (
        <div className={`mt-3 flex flex-wrap gap-2 border-t pt-3 ${light ? "border-white/15" : "border-black/[0.06] dark:border-white/[0.07]"}`}>
            {items.map((asset) => (
                <div key={asset.id} className="w-20 overflow-hidden rounded-xl bg-black/5 dark:bg-white/5">
                    {asset.url ? <DetailImagePreview src={asset.url} alt={asset.name} classNames={{ root: "!block aspect-square w-full cursor-zoom-in", image: "h-full w-full object-cover" }} previewCover={<span className="text-[9px] font-medium">点击放大</span>} /> : <div className="aspect-square" />}
                    <div className={`truncate px-1.5 py-1 text-[8px] ${light ? "text-white/70" : "text-stone-500"}`}>{asset.name}</div>
                </div>
            ))}
        </div>
    );
}

function AssistantDetails({ turn, defaultOpen, canRequestNextStep, onRequestNextStep }: { turn: NonNullable<ProductDetailConversationMessage["turn"]>; defaultOpen: boolean; canRequestNextStep: boolean; onRequestNextStep: () => void }) {
    const [expanded, setExpanded] = useState(defaultOpen);
    useEffect(() => { if (defaultOpen) setExpanded(true); }, [defaultOpen, turn]);
    const briefChanges = briefPatchDetails(turn.briefPatch);
    const assumptions = detailDisplayItems(turn.assumptions);
    const risks = detailDisplayItems(turn.risks);
    const hasDetails = briefChanges.length || assumptions.length || risks.length || turn.skillCandidate || turn.readyToPlan;
    if (!hasDetails) return null;
    const summaryItems = briefChanges.length + assumptions.length + risks.length + (turn.skillCandidate ? 1 : 0) + (turn.readyToPlan ? 1 : 0);
    return (
        <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} className="group/details mt-3 overflow-hidden rounded-[16px] border border-black/[0.06] bg-white/55 dark:border-white/[0.07] dark:bg-white/[0.025]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[11px] font-medium text-stone-600 transition hover:bg-white/70 hover:text-stone-900 dark:text-stone-200 dark:hover:bg-white/[0.06] dark:hover:text-white [&::-webkit-details-marker]:hidden">
                <Sparkles className="size-3.5" />
                <span>本轮整理结果</span>
                <span className="text-stone-300 dark:text-stone-600">·</span>
                <span>{summaryItems} 项</span>
                <ChevronDown className="ml-auto size-3.5 transition-transform group-open/details:rotate-180" />
            </summary>
            <div className="space-y-2.5 border-t border-black/[0.05] px-3.5 py-3 text-[11px] leading-5 dark:border-white/[0.06]">
                {briefChanges.length ? (
                    <div className="rounded-xl bg-emerald-50/70 px-3 py-2.5 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
                        <div className="mb-2 font-medium">已整理的具体信息</div>
                        <div className="space-y-1.5">
                            {briefChanges.map((item) => (
                                <div key={item.label} className="grid grid-cols-[76px_1fr] gap-2">
                                    <span className="text-emerald-700/70 dark:text-emerald-300/70">{item.label}</span>
                                    <span className="min-w-0 break-words">{item.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
                {assumptions.length ? (
                    <div className="rounded-xl border border-black/[0.05] bg-stone-50/80 p-2.5 dark:border-white/[0.06] dark:bg-white/[0.035]">
                        <div className="mb-2 flex items-center justify-between"><span className="font-medium">我的理解</span><span className="text-[9px] text-stone-400">{assumptions.length} 条</span></div>
                        <div className="space-y-1.5">
                            {assumptions.map((item, index) => (
                                <div key={`${item.text}-${index}`} className="flex items-start gap-2 rounded-lg bg-white/60 px-2.5 py-2 dark:bg-white/[0.03]">
                                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-stone-400 dark:bg-stone-500" />
                                    <span className="min-w-0 flex-1 break-words text-stone-700 dark:text-stone-300">{item.text}</span>
                                    {item.source ? <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-medium ${detailSourceClass(item.source)}`}>{detailSourceLabel(item.source)}</span> : null}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
                {risks.length ? (
                    <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 p-2.5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                        <div className="mb-2 flex items-center justify-between"><span className="font-medium">需要确认</span><span className="text-[9px] text-amber-600/70 dark:text-amber-300/60">{risks.length} 条</span></div>
                        <div className="space-y-1.5">
                            {risks.map((item, index) => (
                                <div key={`${item.text}-${index}`} className="flex items-start gap-2 rounded-lg bg-white/45 px-2.5 py-2 dark:bg-black/10">
                                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                                    <span className="min-w-0 flex-1 break-words">{item.text}</span>
                                    {item.source ? <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-medium ${detailSourceClass(item.source)}`}>{detailSourceLabel(item.source)}</span> : null}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
                {turn.skillCandidate ? <div className="rounded-xl bg-violet-50/80 px-3 py-2 text-violet-700 dark:bg-violet-950/20 dark:text-violet-200"><span className="font-medium">可复用风格：</span>{formatDetailText(turn.skillCandidate) || "本轮出现了可沉淀为设计 Skill 的偏好。"}</div> : null}
                {turn.readyToPlan ? <div className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">信息已足够，可以继续下一步</div> : null}
                {canRequestNextStep ? <div className="mt-2"><Button size="small" onClick={onRequestNextStep} className="h-8 rounded-full border-black/[0.08] bg-white px-3 text-[10px] font-medium text-stone-700 shadow-none hover:!border-black/20 hover:!text-stone-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-300 dark:hover:!bg-white/[0.08] dark:hover:!text-white">打开下一步</Button></div> : null}
            </div>
        </details>
    );
}

function BriefGenerationConfirmation({ open, brief, onConfirm, onContinue, onSupplement, onOpenDetails }: {
    open: boolean;
    brief: ProductBrief;
    onConfirm: () => void;
    onContinue: () => void;
    onSupplement: (text: string) => void;
    onOpenDetails: () => void;
}) {
    const [supplement, setSupplement] = useState("");
    const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, string[]>>({});
    const supplementRef = useRef<TextAreaRef>(null);
    const ready = isProductBriefReady(brief);
    const missing = missingProductBriefFields(brief);
    const selectedCount = Object.values(selectedSuggestions).reduce((total, values) => total + values.length, 0);
    const hasSupplement = Boolean(supplement.trim()) || selectedCount > 0;
    useEffect(() => {
        if (!open) {
            setSupplement("");
            setSelectedSuggestions({});
        }
    }, [open]);
    const submitSupplement = () => {
        const selectedText = Object.entries(selectedSuggestions).flatMap(([field, values]) => values.map((value) => suggestionPrompt(field, value)));
        const manualText = supplement.trim();
        if (!manualText && !selectedText.length) return;
        onSupplement([manualText, ...selectedText].filter(Boolean).join("；"));
        setSupplement("");
        setSelectedSuggestions({});
    };
    const fillMissingField = (field: string) => {
        const prompt = missingFieldPrompt(field);
        setSupplement(prompt);
        requestAnimationFrame(() => supplementRef.current?.focus());
    };
    const toggleSuggestion = (field: string, value: string) => {
        setSelectedSuggestions((current) => {
            const values = current[field] || [];
            return {
                ...current,
                [field]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
            };
        });
    };
    const openDetails = () => {
        onContinue();
        onOpenDetails();
    };
    const sellingPoints = brief.sellingPoints.filter((item) => item.source !== "unconfirmed").slice(0, 6);
    return (
        <Modal
            open={open}
            centered
            width={760}
            footer={null}
            maskClosable={false}
            onCancel={onContinue}
            title={<div><div className="text-lg font-semibold tracking-[-0.03em] text-stone-900 dark:text-stone-100">{ready ? "确认商品详情页信息" : "继续完善商品详情页信息"}</div><div className="mt-1 text-xs font-normal text-stone-500 dark:text-stone-400">{ready ? "确认后会先只生成分镜，不会直接扣生图费用。" : `还需补充 ${missing.length} 项关键信息，可以直接在弹窗里继续填写。`}</div></div>}
            className="product-detail-brief-modal"
            styles={{ body: { maxHeight: "calc(100vh - 180px)", overflowY: "auto", paddingRight: 4 } }}
        >
            <div className="space-y-4 pt-1">
                <div className="grid gap-2 sm:grid-cols-3">
                    <ModalSummaryField label="商品" value={brief.productName || "待补充"} />
                    <ModalSummaryField label="类目" value={brief.category || "待补充"} />
                    <ModalSummaryField label="页面数量" value={`${Math.max(6, brief.requiredModules.length || 0)} 页预览结构`} />
                    <ModalSummaryField label="目标人群" value={brief.targetAudience.join("、") || "待补充"} />
                    <ModalSummaryField label="视觉依据" value={[...brief.visualStyle, ...brief.colorPreference].join("、") || "从商品图 / 参考图提取"} />
                    <ModalSummaryField label="投放平台" value={{ taobao: "淘宝/天猫", tmall: "天猫", jd: "京东", pdd: "拼多多" }[brief.platform]} />
                </div>

                <div className="rounded-2xl border border-black/[0.06] bg-stone-50/80 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">核心卖点</div>
                    {sellingPoints.length ? (
                        <div className="mt-2 space-y-1.5">
                            {sellingPoints.map((item) => <div key={item.id} className="flex items-start gap-2 text-xs leading-5 text-stone-700 dark:text-stone-300"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" /><span>{item.text}</span></div>)}
                        </div>
                    ) : <div className="mt-2 text-xs text-stone-400">还没有已确认的核心卖点。</div>}
                    {brief.description ? <div className="mt-3 border-t border-black/[0.05] pt-3 text-xs leading-6 text-stone-500 dark:border-white/[0.06] dark:text-stone-400">{brief.description}</div> : null}
                </div>

                {!ready ? (
                    <div className="space-y-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-3.5 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-medium text-amber-800 dark:text-amber-200">可以多选，选好后统一点击“提交补充”</div>
                            {selectedCount ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">已选 {selectedCount} 项</span> : null}
                        </div>
                        {missing.map((item) => (
                            <div key={item} className="space-y-1.5">
                                <button type="button" onClick={() => fillMissingField(item)} className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-medium text-amber-800 transition hover:bg-white dark:bg-white/[0.06] dark:text-amber-200 dark:hover:bg-white/[0.1]">{item}</button>
                                {MISSING_FIELD_SUGGESTIONS[item]?.length ? <div className="flex flex-wrap gap-1.5">{MISSING_FIELD_SUGGESTIONS[item].map((suggestion) => { const selected = (selectedSuggestions[item] || []).includes(suggestion); return <button key={suggestion} type="button" aria-pressed={selected} onClick={() => toggleSuggestion(item, suggestion)} className={`rounded-full border px-2.5 py-1 text-[10px] transition ${selected ? "border-amber-500 bg-amber-100 font-medium text-amber-900 dark:border-amber-500 dark:bg-amber-900/40 dark:text-amber-100" : "border-amber-200/70 bg-transparent text-amber-700 hover:border-amber-400 hover:bg-amber-100/70 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-950/30"}`}>{selected ? "✓ " : ""}{suggestion}</button>; })}</div> : null}
                            </div>
                        ))}
                    </div>
                ) : null}

                <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-300">下一步</div>
                    <div className={`grid gap-2 ${ready ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                        <ModalAction icon={<MessageSquareText className="size-4" />} title="继续补充" description={ready ? "补充卖点、规格或风格" : "直接补充缺失的信息"} onClick={() => requestAnimationFrame(() => supplementRef.current?.focus())} />
                        <ModalAction icon={<PanelRight className="size-4" />} title="查看关键信息" description="打开右侧工作区逐项检查" onClick={openDetails} />
                        {ready ? <ModalAction icon={<Sparkles className="size-4" />} title="确认生成分镜" description="先生成分镜，再确认生图" primary onClick={onConfirm} /> : null}
                    </div>
                </div>

                <div className="rounded-2xl border border-black/[0.07] bg-white/70 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.035]">
                    <div className="mb-1.5 text-[11px] font-medium text-stone-600 dark:text-stone-200">直接补充或修改需求</div>
                    <Input.TextArea
                        ref={supplementRef}
                        value={supplement}
                        onChange={(event) => setSupplement(event.target.value)}
                        placeholder="例如：容量 500ml；品牌色 #1D6FB4；礼盒包装；避免“最”字宣传…"
                        autoSize={{ minRows: 3, maxRows: 6 }}
                        variant="borderless"
                        className="!p-0 !text-sm !leading-6 !text-stone-800 placeholder:!text-stone-400 dark:!text-stone-100 dark:placeholder:!text-stone-500"
                        onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitSupplement(); } }}
                    />
                    <div className="mt-2 flex items-center justify-between border-t border-black/[0.05] pt-2 dark:border-white/[0.06]">
                        <span className="text-[10px] text-stone-500 dark:text-stone-400">Ctrl / Cmd + Enter 提交补充</span>
                        <Button onClick={submitSupplement} disabled={!hasSupplement} className="h-8 rounded-full border-black/10 px-3 text-[10px] text-stone-700 dark:border-white/15 dark:bg-white/[0.08] dark:text-stone-100 dark:disabled:text-stone-500">{selectedCount ? `提交补充（${selectedCount + (supplement.trim() ? 1 : 0)} 项）` : "提交补充"}</Button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
                    <Button type="text" onClick={onContinue} className="rounded-full text-xs text-stone-500 hover:!text-stone-900 dark:text-stone-400 dark:hover:!text-white">暂不生成</Button>
                    <Button type="primary" disabled={!ready} onClick={onConfirm} className="h-10 rounded-full border-0 bg-[#22211f] px-5 text-xs font-semibold shadow-none hover:!bg-black disabled:opacity-40 dark:!bg-stone-100 dark:!text-stone-950 dark:hover:!bg-white dark:hover:!text-stone-950">{ready ? "确认并生成分镜" : `还需补充 ${missing.length} 项`}</Button>
                </div>
            </div>
        </Modal>
    );
}

const MISSING_FIELD_SUGGESTIONS: Record<string, string[]> = {};

function missingFieldPrompt(field: string) {
    return `${field}：`;
}

function suggestionPrompt(field: string, value: string) {
    if (field === "目标人群") return `目标人群是：${value}`;
    if (field === "核心卖点") return `补充核心卖点：${value}`;
    if (field === "商品类目") return `商品类目是：${value}`;
    if (field === "视觉风格") return `视觉风格偏好：${value}`;
    return `${field}：${value}`;
}

function ModalSummaryField({ label, value }: { label: string; value: string }) {
    return <div className="rounded-xl border border-black/[0.05] bg-stone-50/70 px-3 py-2.5 dark:border-white/[0.09] dark:bg-white/[0.055]"><div className="text-[9px] font-medium uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400">{label}</div><div className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-stone-800 dark:text-stone-100">{value}</div></div>;
}

function ModalAction({ icon, title, description, primary = false, onClick }: { icon: React.ReactNode; title: string; description: string; primary?: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className={`flex min-h-[82px] items-start gap-2.5 rounded-2xl border p-3 text-left transition ${primary ? "border-stone-900 bg-stone-900 text-white hover:bg-black dark:border-stone-100 dark:!bg-stone-100 dark:!text-stone-950 dark:hover:bg-white dark:hover:!text-stone-950" : "border-black/[0.09] bg-white/70 text-stone-800 hover:border-black/20 hover:bg-white dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-stone-100 dark:hover:border-white/25 dark:hover:bg-white/[0.1]"}`}>
            <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${primary ? "bg-black/10 text-white dark:bg-stone-950/10 dark:text-stone-950" : "bg-stone-100 text-stone-700 dark:bg-white/[0.09] dark:text-stone-100"}`}>{icon}</span>
            <span className="min-w-0">
                <span className={`block text-xs font-semibold ${primary ? "text-white dark:text-stone-950" : "text-stone-800 dark:text-stone-100"}`}>{title}</span>
                <span className={`mt-1 block text-[10px] leading-4 ${primary ? "text-white/75 dark:text-stone-700" : "text-stone-500 dark:text-stone-400"}`}>{description}</span>
            </span>
        </button>
    );
}

function OperationProgress({ operation }: { operation: ProductDetailOperation | null }) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!operation) return;
        const update = () => setElapsed(Math.max(0, Date.now() - operation.startedAt));
        update();
        const timer = window.setInterval(update, 100);
        return () => window.clearInterval(timer);
    }, [operation]);
    if (!operation) return null;
    const title = operation.label || (operation.kind === "images" ? "正在生成页面图片" : operation.kind === "storyboard" ? "正在生成页面分镜" : "正在理解你的需求");
    const detail = operation.kind === "images" ? "正在逐页生成底图，完成的页面会立即保存到本地。" : operation.kind === "storyboard" ? "正在整理页面结构、文案和视觉方向。" : "正在读取商品信息、更新 Brief，并准备下一步动作。";
    return (
        <div className="mt-7 flex items-start justify-start">
            <div className="min-w-0 max-w-[90%]">
                <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.02em] text-stone-900 dark:text-stone-100">
                    <Spin size="small" />
                    <span>{title}</span>
                    <span className="font-normal text-stone-400">{(elapsed / 1000).toFixed(1)}s</span>
                </div>
                <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{detail}</div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-stone-200/70 dark:bg-white/10">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-[#22211f] dark:bg-stone-200" />
                </div>
            </div>
        </div>
    );
}

function detailDisplayItems(values: unknown[]) {
    return values.map((value) => {
        let source = "";
        if (typeof value === "string") {
            source = value.match(/^(user|visible|unconfirmed|assistant|system)\s*[:：]/i)?.[1]?.toLowerCase() || "";
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            source = typeof record.source === "string" ? record.source.toLowerCase() : "";
            if (!source) source = ["user", "visible", "unconfirmed", "assistant", "system"].find((key) => record[key] != null) || "";
        }
        const text = formatDetailText(value);
        return text && text !== "[object Object]" ? { text, source } : null;
    }).filter((item): item is { text: string; source: string } => Boolean(item));
}

function detailSourceLabel(source: string) {
    return ({ user: "用户确认", visible: "图片可见", unconfirmed: "待确认", assistant: "AI 理解", system: "系统" } as Record<string, string>)[source] || "";
}

function detailSourceClass(source: string) {
    if (source === "user") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
    if (source === "visible") return "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300";
    if (source === "unconfirmed") return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
    return "bg-stone-100 text-stone-500 dark:bg-white/[0.06] dark:text-stone-400";
}

function briefPatchDetails(patch?: ProductBriefPatch): Array<{ label: string; value: string }> {
    if (!patch) return [];
    const labels: Partial<Record<keyof ProductBriefPatch, string>> = {
        productName: "商品名称", category: "商品类目", description: "商品说明", platform: "目标平台", pricePosition: "价格定位",
        targetAudience: "目标人群", scenarios: "使用场景", visualStyle: "视觉风格", colorPreference: "品牌色",
        copyTone: "文案语气", forbiddenContent: "禁用表达", sellingPoints: "核心卖点", requiredModules: "页面结构",
        productAssetIds: "商品图", referenceAssetIds: "参考素材", assumptions: "补充假设",
    };
    const platforms: Record<string, string> = { taobao: "淘宝/天猫", tmall: "天猫", jd: "京东", pdd: "拼多多" };
    const pricePositions: Record<string, string> = { budget: "性价比", mid: "中端", premium: "高端" };
    const roles: Record<string, string> = { hero: "首屏", "pain-point": "痛点", "core-benefit": "核心利益", "feature-detail": "细节", scenario: "场景", "how-to-use": "使用方法", specification: "规格", trust: "信任", closing: "收尾" };
    return Object.entries(patch)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
            let display = "";
            if (key === "platform") display = platforms[String(value)] || String(value);
            else if (key === "pricePosition") display = pricePositions[String(value)] || String(value);
            else if (key === "productAssetIds" || key === "referenceAssetIds") display = `${Array.isArray(value) ? value.length : 0} 张`;
            else if (key === "requiredModules" && Array.isArray(value)) display = value.map((item) => roles[String(item)] || formatDetailText(item)).join("、");
            else if (Array.isArray(value)) display = value.map(formatDetailText).filter(Boolean).join("、");
            else display = formatDetailText(value);
            return { label: labels[key as keyof ProductBriefPatch] || key, value: display || "未填写" };
        })
        .filter((item) => item.value);
}

function actionLabel(type: ProductDetailAgentAction["type"]) {
    return ({ plan_storyboard: "生成页面分镜", generate_all_images: "生成全部底图", open_results: "查看生成结果", open_export: "打开导出", save_skill: "沉淀为我的 Skill" } as const)[type];
}

function formatMessageTime(value: number) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}
