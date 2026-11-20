import { Send, Sparkles } from "lucide-react";
import { Button, Input, Spin } from "antd";
import { useTranslation } from "react-i18next";
import type { ProductDetailConversationMessage } from "@/types/product-detail";

export function ConversationPanel({ messages, value, busy, storyboardBusy, canPlan, onChange, onSend, onGenerateStoryboard }: { messages: ProductDetailConversationMessage[]; value: string; busy: boolean; storyboardBusy: boolean; canPlan: boolean; onChange: (value: string) => void; onSend: () => void; onGenerateStoryboard: () => void; }) {
    const { t } = useTranslation();
    return (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-stone-50 dark:bg-stone-950">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-stone-200 px-5 dark:border-stone-800"><div><div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("productDetail.chatTitle")}</div><div className="text-[11px] text-stone-500">{t("productDetail.subtitle")}</div></div><Button icon={<Sparkles className="size-4" />} loading={storyboardBusy} disabled={!canPlan || busy} onClick={onGenerateStoryboard}>{t("productDetail.generateStoryboard")}</Button></div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {messages.length ? messages.map((message) => (
                    <div key={message.id} className={`mb-3 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-br-md bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950" : "rounded-bl-md border border-stone-200 bg-white text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"}`}>{message.content}{message.error ? <div className="mt-2 text-xs text-red-500">{message.error}</div> : null}</div></div>
                )) : <div className="mx-auto mt-20 max-w-md rounded-2xl border border-dashed border-stone-300 bg-white/60 p-8 text-center dark:border-stone-700 dark:bg-stone-900/30"><Sparkles className="mx-auto mb-3 size-7 text-orange-500" /><div className="text-sm font-medium text-stone-700 dark:text-stone-300">{t("productDetail.chatTitle")}</div><p className="mt-2 text-xs leading-6 text-stone-500">{t("productDetail.chatPlaceholder")}</p></div>}
                {busy ? <div className="flex items-center gap-2 py-2 text-xs text-stone-500"><Spin size="small" />{t("productDetail.generating")}</div> : null}
            </div>
            <div className="shrink-0 border-t border-stone-200 bg-white/80 p-4 dark:border-stone-800 dark:bg-stone-950/70"><div className="rounded-2xl border border-stone-200 bg-white p-2 shadow-sm focus-within:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:focus-within:border-stone-600"><Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("productDetail.chatPlaceholder")} autoSize={{ minRows: 2, maxRows: 6 }} variant="borderless" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (value.trim() && !busy) onSend(); } }} /><div className="flex justify-end border-t border-stone-100 pt-2 dark:border-stone-800"><Button type="primary" icon={<Send className="size-4" />} loading={busy} disabled={!value.trim()} onClick={onSend}>{t("productDetail.send")}</Button></div></div></div>
        </section>
    );
}
