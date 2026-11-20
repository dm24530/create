import { useRef } from "react";
import { ChevronDown, ImagePlus, Paperclip, Send, Sparkles, Upload, X } from "lucide-react";
import { Button, Dropdown, Input, Select, Spin, Tag, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import type { ProductDetailAsset, ProductDetailConversationMessage } from "@/types/product-detail";

export function ConversationPanel({ messages, value, busy, storyboardBusy, canPlan, models, modelValue, attachments, uploading, onChange, onModelChange, onUpload, onRemoveAttachment, onSend, onGenerateStoryboard }: {
    messages: ProductDetailConversationMessage[];
    value: string;
    busy: boolean;
    storyboardBusy: boolean;
    canPlan: boolean;
    models: Array<{ value: string; label: string }>;
    modelValue: string;
    attachments: ProductDetailAsset[];
    uploading: boolean;
    onChange: (value: string) => void;
    onModelChange: (value: string) => void;
    onUpload: (kind: "product" | "reference", files: FileList | null) => void;
    onRemoveAttachment: (assetId: string) => void;
    onSend: () => void;
    onGenerateStoryboard: () => void;
}) {
    const { t } = useTranslation();
    const productInputRef = useRef<HTMLInputElement>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    return (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-stone-50 dark:bg-stone-950">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-stone-200 px-5 dark:border-stone-800"><div><div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("productDetail.chatTitle")}</div><div className="text-[11px] text-stone-500">通过对话收集商品资料、设计想法和参考素材</div></div><Button icon={<Sparkles className="size-4" />} loading={storyboardBusy} disabled={!canPlan || busy} onClick={onGenerateStoryboard}>{t("productDetail.generateStoryboard")}</Button></div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {messages.length ? messages.map((message) => (
                    <div key={message.id} className={`mb-3 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-br-md bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950" : "rounded-bl-md border border-stone-200 bg-white text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"}`}>{message.content}{message.error ? <div className="mt-2 text-xs text-red-500">{message.error}</div> : null}</div></div>
                )) : <div className="mx-auto mt-20 max-w-md rounded-2xl border border-dashed border-stone-300 bg-white/60 p-8 text-center dark:border-stone-700 dark:bg-stone-900/30"><Sparkles className="mx-auto mb-3 size-7 text-orange-500" /><div className="text-sm font-medium text-stone-700 dark:text-stone-300">把商品页交给 AI 策划</div><p className="mt-2 text-xs leading-6 text-stone-500">上传商品图或参考详情页，然后直接描述商品、平台、卖点和想要的感觉。信息足够后再生成分镜。</p></div>}
                {busy ? <div className="flex items-center gap-2 py-2 text-xs text-stone-500"><Spin size="small" />正在理解你的设计想法…</div> : null}
            </div>
            <div className="shrink-0 border-t border-stone-200 bg-white/80 p-4 dark:border-stone-800 dark:bg-stone-950/70">
                <div className="rounded-2xl border border-stone-200 bg-white p-2 shadow-sm focus-within:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:focus-within:border-stone-600">
                    <div className="flex items-center gap-2 px-1 pb-2">
                        <Select
                            size="small"
                            variant="borderless"
                            value={modelValue || undefined}
                            options={models}
                            placeholder="选择内置 AI 模型"
                            showSearch
                            optionFilterProp="label"
                            popupMatchSelectWidth={false}
                            suffixIcon={<ChevronDown className="size-3.5" />}
                            className="max-w-[260px] font-medium"
                            onChange={onModelChange}
                        />
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
                        <div className="ml-auto text-[10px] text-stone-400">模型由后台内置分组提供</div>
                    </div>
                    {attachments.length ? <div className="flex gap-2 overflow-x-auto border-t border-stone-100 px-1 py-2 dark:border-stone-800">{attachments.map((asset) => <div key={asset.id} className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">{asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">{asset.kind === "product" ? "商品图" : "参考图"}</span><Tooltip title="移除"><button type="button" className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white" onClick={() => onRemoveAttachment(asset.id)}><X className="size-3" /></button></Tooltip></div>)}</div> : null}
                    <Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} placeholder="描述商品、目标人群、平台、卖点或设计风格，也可以直接粘贴商品页信息" autoSize={{ minRows: 3, maxRows: 8 }} variant="borderless" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (value.trim() && !busy) onSend(); } }} />
                    <div className="flex items-center justify-between border-t border-stone-100 px-1 pt-2 dark:border-stone-800"><span className="text-[11px] text-stone-400">Enter 发送 · Shift + Enter 换行</span><Button type="primary" icon={<Send className="size-4" />} loading={busy} disabled={!value.trim()} onClick={onSend}>{t("productDetail.send")}</Button></div>
                    <input ref={productInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { onUpload("product", event.target.files); event.target.value = ""; }} />
                    <input ref={referenceInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { onUpload("reference", event.target.files); event.target.value = ""; }} />
                </div>
            </div>
        </section>
    );
}
