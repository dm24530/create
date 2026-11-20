import { useEffect, useRef } from "react";
import { AlertTriangle, ChevronDown, ImagePlus, MessageSquareText, Paperclip, Send, Sparkles, Upload, X } from "lucide-react";
import { Button, Dropdown, Input, Select, Spin, Tag, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useTranslation } from "react-i18next";
import type { ProductBriefPatch, ProductDetailAgentAction, ProductDetailAsset, ProductDetailConversationMessage } from "@/types/product-detail";

export function ConversationPanel({
    messages,
    value,
    busy,
    storyboardBusy,
    canPlan,
    models,
    modelValue,
    imageModels,
    imageModelValue,
    attachments,
    uploading,
    focusToken,
    onChange,
    onModelChange,
    onImageModelChange,
    onUpload,
    onRemoveAttachment,
    onSend,
    onGenerateStoryboard,
    onQuickReply,
    onAction,
}: {
    messages: ProductDetailConversationMessage[];
    value: string;
    busy: boolean;
    storyboardBusy: boolean;
    canPlan: boolean;
    models: Array<{ value: string; label: string }>;
    modelValue: string;
    imageModels: Array<{ value: string; label: string }>;
    imageModelValue: string;
    attachments: ProductDetailAsset[];
    uploading: boolean;
    focusToken: number;
    onChange: (value: string) => void;
    onModelChange: (value: string) => void;
    onImageModelChange: (value: string) => void;
    onUpload: (kind: "product" | "reference", files: FileList | null) => void;
    onRemoveAttachment: (assetId: string) => void;
    onSend: () => void;
    onGenerateStoryboard: () => void;
    onQuickReply: (text: string) => void;
    onAction: (action: ProductDetailAgentAction, message: ProductDetailConversationMessage) => void;
}) {
    const { t } = useTranslation();
    const productInputRef = useRef<HTMLInputElement>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<TextAreaRef>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const hasTextModel = models.length > 0 && Boolean(modelValue);
    const hasImageModel = imageModels.length > 0 && Boolean(imageModelValue);
    const latestAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;

    useEffect(() => {
        if (focusToken > 0) requestAnimationFrame(() => textareaRef.current?.focus());
    }, [focusToken]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: "end" });
    }, [messages.length, busy]);

    return (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-stone-50 dark:bg-stone-950">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 px-5 dark:border-stone-800">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100"><MessageSquareText className="size-4 text-orange-500" />{t("productDetail.chatTitle")}</div>
                    <div className="mt-0.5 text-[11px] text-stone-500">边聊边整理 Brief；随时补充、推翻或细化上一轮要求</div>
                </div>
                <Button icon={<Sparkles className="size-4" />} loading={storyboardBusy} disabled={!canPlan || busy || !hasTextModel} onClick={onGenerateStoryboard}>现在生成分镜</Button>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {messages.length ? messages.map((message) => {
                    const isLatestAssistant = message.id === latestAssistantId;
                    const questionOptions = isLatestAssistant ? message.turn?.question?.options : undefined;
                    const actions = isLatestAssistant ? message.turn?.actions : undefined;
                    return (
                        <div key={message.id} className={`mb-4 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === "user" ? "rounded-br-md bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950" : "rounded-bl-md border border-stone-200 bg-white text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"}`}>
                                <div className="whitespace-pre-wrap break-words">{message.content}</div>
                                {message.error ? <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-600 dark:bg-red-950/30 dark:text-red-300">{message.error}</div> : null}
                                {message.role === "assistant" && message.turn ? <AssistantDetails turn={message.turn} /> : null}
                                {message.turn?.question?.prompt && message.turn.question.prompt.trim() !== message.content.trim() ? <div className="mt-3 text-xs font-medium text-stone-600 dark:text-stone-300">{message.turn.question.prompt}</div> : null}
                                {questionOptions?.length ? (
                                    <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                                        <div className="mb-2 text-[11px] text-stone-500">可以直接选择一个补充项：</div>
                                        <div className="flex flex-wrap gap-1.5">{questionOptions.map((option) => <Button key={option} size="small" disabled={busy || !hasTextModel} onClick={() => onQuickReply(option)}>{option}</Button>)}</div>
                                    </div>
                                ) : null}
                                {actions?.length ? (
                                    <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                                        <div className="mb-2 text-[11px] text-stone-500">Agent 建议的下一步：</div>
                                        <div className="flex flex-wrap gap-1.5">{actions.map((action, index) => <Button key={`${action.type}-${index}`} size="small" type="primary" ghost disabled={busy} onClick={() => onAction(action, message)}>{action.label || actionLabel(action.type)}</Button>)}</div>
                                    </div>
                                ) : null}
                                {message.assetIds?.length ? <div className="mt-2 text-[10px] opacity-60">随消息提交了 {message.assetIds.length} 张附件</div> : null}
                            </div>
                        </div>
                    );
                }) : <div className="mx-auto mt-20 max-w-md rounded-2xl border border-dashed border-stone-300 bg-white/60 p-8 text-center dark:border-stone-700 dark:bg-stone-900/30"><Sparkles className="mx-auto mb-3 size-7 text-orange-500" /><div className="text-sm font-medium text-stone-700 dark:text-stone-300">把商品页交给 AI 策划</div><p className="mt-2 text-xs leading-6 text-stone-500">上传商品图或参考详情页，然后直接描述商品、平台、卖点和想要的感觉。</p></div>}
                {busy ? <div className="flex items-center gap-2 py-2 text-xs text-stone-500"><Spin size="small" />正在理解你的设计想法并更新 Brief…</div> : null}
                <div ref={endRef} />
            </div>

            <div className="shrink-0 border-t border-stone-200 bg-white/85 p-4 dark:border-stone-800 dark:bg-stone-950/75">
                {!hasTextModel ? <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>后台创作分组还没有可用的文本模型。添加后这里会自动出现，不需要用户手动配置。</span></div> : null}
                <div className="rounded-2xl border border-stone-200 bg-white p-2 shadow-sm focus-within:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:focus-within:border-stone-600">
                    <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
                        <Select
                            size="small"
                            variant="borderless"
                            value={modelValue || undefined}
                            options={models}
                            placeholder={models.length ? "选择策划模型" : "等待后台文本模型"}
                            showSearch
                            optionFilterProp="label"
                            popupMatchSelectWidth={false}
                            suffixIcon={<ChevronDown className="size-3.5" />}
                            className="max-w-[220px] font-medium"
                            disabled={!models.length}
                            onChange={onModelChange}
                        />
                        <span className="text-[10px] text-stone-400">策划</span>
                        <Select
                            size="small"
                            variant="borderless"
                            value={imageModelValue || undefined}
                            options={imageModels}
                            placeholder={imageModels.length ? "选择生图模型" : "等待生图模型"}
                            showSearch
                            optionFilterProp="label"
                            popupMatchSelectWidth={false}
                            suffixIcon={<ChevronDown className="size-3.5" />}
                            className="max-w-[220px] font-medium"
                            disabled={!imageModels.length}
                            onChange={onImageModelChange}
                        />
                        <span className="text-[10px] text-stone-400">生图</span>
                        <Dropdown
                            trigger={["click"]}
                            menu={{ items: [
                                { key: "product", label: "上传商品图", icon: <ImagePlus className="size-3.5" /> },
                                { key: "reference", label: "上传参考详情页 / 参考图", icon: <Upload className="size-3.5" /> },
                            ], onClick: ({ key }) => (key === "product" ? productInputRef.current?.click() : referenceInputRef.current?.click()) }}
                        >
                            <Button size="small" type="text" icon={<Paperclip className="size-4" />} loading={uploading} />
                        </Dropdown>
                        <Tag className="m-0 text-[10px]" color="blue">创作密钥计费</Tag>
                        {!hasImageModel ? <Tag className="m-0 text-[10px]" color="orange">生图模型待配置</Tag> : null}
                        <div className="ml-auto text-[10px] text-stone-400">模型由后台创作分组提供</div>
                    </div>
                    {attachments.length ? <div className="flex gap-2 overflow-x-auto border-t border-stone-100 px-1 py-2 dark:border-stone-800">{attachments.map((asset) => <div key={asset.id} className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">{asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">{asset.kind === "product" ? "商品图" : "参考图"}</span><Tooltip title="移除"><button type="button" className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white" onClick={() => onRemoveAttachment(asset.id)}><X className="size-3" /></button></Tooltip></div>)}</div> : null}
                    <Input.TextArea ref={textareaRef} value={value} onChange={(event) => onChange(event.target.value)} placeholder="直接说需求，也可以补充或推翻前文。例如：改成京东，卖给通勤人群，风格更高级…" autoSize={{ minRows: 3, maxRows: 8 }} variant="borderless" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (value.trim() && !busy && hasTextModel) onSend(); } }} />
                    <div className="flex items-center justify-between border-t border-stone-100 px-1 pt-2 dark:border-stone-800"><span className="text-[11px] text-stone-400">Enter 发送 · Shift + Enter 换行</span><Button type="primary" icon={<Send className="size-4" />} loading={busy} disabled={!value.trim() || !hasTextModel} onClick={onSend}>{t("productDetail.send")}</Button></div>
                    <input ref={productInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { onUpload("product", event.target.files); event.target.value = ""; }} />
                    <input ref={referenceInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { onUpload("reference", event.target.files); event.target.value = ""; }} />
                </div>
            </div>
        </section>
    );
}

function AssistantDetails({ turn }: { turn: NonNullable<ProductDetailConversationMessage["turn"]> }) {
    const briefChanges = briefPatchSummary(turn.briefPatch);
    const hasDetails = briefChanges.length || turn.assumptions.length || turn.risks.length || turn.skillCandidate || turn.readyToPlan;
    if (!hasDetails) return null;
    return (
        <div className="mt-3 space-y-2 border-t border-stone-100 pt-3 text-xs dark:border-stone-800">
            {briefChanges.length ? <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-200"><div className="mb-1 font-medium">已更新 Brief</div><div className="leading-5">{briefChanges.join(" · ")}</div></div> : null}
            {turn.assumptions.length ? <div className="rounded-lg bg-stone-50 px-2.5 py-2 dark:bg-stone-950/60"><span className="font-medium">我的理解：</span>{turn.assumptions.join("；")}</div> : null}
            {turn.risks.length ? <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200"><span className="font-medium">需要确认：</span>{turn.risks.join("；")}</div> : null}
            {turn.skillCandidate ? <div className="rounded-lg bg-violet-50 px-2.5 py-2 text-violet-700 dark:bg-violet-950/20 dark:text-violet-200"><span className="font-medium">可沉淀的设计偏好：</span>本轮对话中出现了可复用的风格信息，可在确认后保存为我的 Skill。</div> : null}
            {turn.readyToPlan ? <div className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">信息已足够，可以生成分镜</div> : null}
        </div>
    );
}

function briefPatchSummary(patch?: ProductBriefPatch) {
    if (!patch) return [];
    const labels: Partial<Record<keyof ProductBriefPatch, string>> = {
        productName: "商品名称", category: "类目", description: "商品说明", platform: "平台", pricePosition: "价格定位",
        targetAudience: "目标人群", scenarios: "使用场景", visualStyle: "视觉风格", colorPreference: "品牌色",
        copyTone: "文案语气", forbiddenContent: "禁用表达", sellingPoints: "核心卖点", requiredModules: "页面结构",
    };
    return Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => labels[key as keyof ProductBriefPatch] || key);
}

function actionLabel(type: ProductDetailAgentAction["type"]) {
    return ({ plan_storyboard: "生成页面分镜", generate_all_images: "生成全部底图", open_results: "查看生成结果", open_export: "打开导出", save_skill: "沉淀为我的 Skill" } as const)[type];
}
