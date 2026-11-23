import { useMemo, useState } from "react";
import { CheckCircle2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Input, Modal, Select, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ProductDetailPlatform, ProductPageRole, UserDesignSkill } from "@/types/product-detail";

export type CustomSkillInput = {
    name: string;
    description: string;
    scope: "global" | "category" | "platform";
    category?: string;
    platform?: ProductDetailPlatform;
    pagePatterns: UserDesignSkill["pagePatterns"];
    categoryKnowledge: string[];
    complianceRules: string[];
    forbiddenPhrases: string[];
};

type SkillDraft = {
    name: string;
    description: string;
    scope: "global" | "category" | "platform";
    category?: string;
    platform?: ProductDetailPlatform;
    patternsText: string;
    knowledgeText: string;
    forbiddenText: string;
};

const ROLE_FIELDS: Array<{ role: ProductPageRole; label: string }> = [
    { role: "hero", label: "首屏" },
    { role: "pain-point", label: "痛点" },
    { role: "core-benefit", label: "利益" },
    { role: "feature-detail", label: "细节" },
    { role: "scenario", label: "场景" },
    { role: "how-to-use", label: "步骤" },
    { role: "specification", label: "规格" },
    { role: "trust", label: "信任" },
    { role: "closing", label: "收尾" },
];

const EMPTY_DRAFT: SkillDraft = { name: "", description: "", scope: "global", patternsText: "", knowledgeText: "", forbiddenText: "" };

export function SkillManagerModal({ open, skills, projectSkillIds, recommendedSkillId, canCreateProjectSkill, onClose, onToggle, onDelete, onCreateFromProject, onCreateCustom, onUpdateSkill, onAttach }: {
    open: boolean;
    skills: UserDesignSkill[];
    projectSkillIds: string[];
    recommendedSkillId?: string;
    canCreateProjectSkill: boolean;
    onClose: () => void;
    onToggle: (skillId: string, enabled: boolean) => void;
    onDelete: (skillId: string) => void;
    onCreateFromProject: () => void;
    onCreateCustom: (input: CustomSkillInput) => void;
    onUpdateSkill: (skillId: string, input: CustomSkillInput) => void;
    onAttach: (skillId: string) => void;
}) {
    const { t } = useTranslation();
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<UserDesignSkill | null>(null);
    const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
    const orderedSkills = useMemo(() => [...skills].sort((left, right) => {
        const leftApplied = projectSkillIds.includes(left.id) ? 2 : recommendedSkillId === left.id ? 1 : 0;
        const rightApplied = projectSkillIds.includes(right.id) ? 2 : recommendedSkillId === right.id ? 1 : 0;
        return rightApplied - leftApplied || right.updatedAt - left.updatedAt;
    }), [projectSkillIds, recommendedSkillId, skills]);
    const scopeLabel = (skill: UserDesignSkill) => skill.scope === "category"
        ? t("productDetail.skillScopeCategory", { value: skill.category || t("productDetail.unspecified") })
        : skill.scope === "platform"
            ? t("productDetail.skillScopePlatform", { value: skill.platform || t("productDetail.unspecified") })
            : t("productDetail.skillScopeGlobal");
    const valid = Boolean(draft.name.trim()) && (draft.scope !== "category" || Boolean(draft.category?.trim())) && (draft.scope !== "platform" || Boolean(draft.platform));
    const openCreate = () => {
        setEditingSkill(null);
        setDraft(EMPTY_DRAFT);
        setEditorOpen(true);
    };
    const openEdit = (skill: UserDesignSkill) => {
        const builtIn = skill.id.startsWith("builtin-");
        setEditingSkill(skill);
        setDraft({
            name: builtIn ? `${skill.name}（自定义版）` : skill.name,
            description: skill.description,
            scope: skill.scope,
            category: skill.category,
            platform: skill.platform,
            patternsText: ROLE_FIELDS.flatMap(({ role, label }) => {
                const guidance = skill.pagePatterns.find((pattern) => pattern.role === role)?.guidance;
                return guidance ? [`${label}：${guidance}`] : [];
            }).join("\n"),
            knowledgeText: skill.categoryKnowledge.join("\n"),
            forbiddenText: skill.copy.forbiddenPhrases.join("\n"),
        });
        setEditorOpen(true);
    };
    const submit = () => {
        if (!valid) return;
        const forbiddenPhrases = lines(draft.forbiddenText);
        const input: CustomSkillInput = {
            name: draft.name.trim(),
            description: draft.description.trim(),
            scope: draft.scope,
            category: draft.scope === "category" ? draft.category?.trim() : undefined,
            platform: draft.scope === "platform" ? draft.platform : undefined,
            pagePatterns: parsePagePatterns(draft.patternsText),
            categoryKnowledge: lines(draft.knowledgeText),
            complianceRules: forbiddenPhrases,
            forbiddenPhrases,
        };
        if (editingSkill && !editingSkill.id.startsWith("builtin-")) onUpdateSkill(editingSkill.id, input);
        else onCreateCustom(input);
        setDraft(EMPTY_DRAFT);
        setEditingSkill(null);
        setEditorOpen(false);
    };
    return (
        <>
            <Modal open={open} onCancel={onClose} footer={null} width={780} title={t("productDetail.skills")}>
                <div className="mb-4 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-medium">{t("productDetail.skillHint")}</div>
                            <div className="mt-1 text-xs text-stone-500">{t("productDetail.skillAutoHint")} · {t("productDetail.skillCount", { count: skills.length })}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button disabled={!canCreateProjectSkill} onClick={onCreateFromProject}>{t("productDetail.skillFromProject")}</Button>
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>{t("productDetail.skillCreateCustom")}</Button>
                        </div>
                    </div>
                </div>
                <div className="thin-scrollbar max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                    {orderedSkills.length ? orderedSkills.map((skill) => {
                        const attached = projectSkillIds.includes(skill.id);
                        const builtIn = skill.id.startsWith("builtin-");
                        const recommended = recommendedSkillId === skill.id && !attached;
                        return (
                            <div key={skill.id} className={`rounded-xl border p-3 ${recommended ? "border-orange-300 bg-orange-50/40 dark:border-orange-800 dark:bg-orange-950/10" : "border-stone-200 dark:border-stone-800"}`}>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Sparkles className="size-4 text-orange-500" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <div className="truncate text-sm font-medium">{skill.name}</div>
                                            {builtIn ? <Tag color="gold" className="m-0">{t("productDetail.skillBuiltIn")}</Tag> : null}
                                            {recommended ? <Tag color="orange" className="m-0">{t("productDetail.skillRecommended")}</Tag> : null}
                                            {attached ? <Tag color="green" className="m-0">{t("productDetail.skillApplied")}</Tag> : null}
                                        </div>
                                        <div className="mt-1 truncate text-xs text-stone-500">{skill.description}</div>
                                        <div className="mt-1 text-[10px] text-stone-400">v{skill.revision} · {t("productDetail.skillLearnedProjects", { count: skill.sourceProjectIds.length })} · {scopeLabel(skill)}</div>
                                    </div>
                                    <SkillEnabledToggle label={skill.name} enabled={skill.enabled} onChange={(enabled) => onToggle(skill.id, enabled)} />
                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(skill)}>{builtIn ? t("productDetail.skillCloneAdjust") : t("productDetail.skillAdjust")}</Button>
                                    <Button size="small" icon={attached ? <CheckCircle2 className="size-3.5" /> : undefined} disabled={attached || !skill.enabled} onClick={() => onAttach(skill.id)}>{attached ? t("productDetail.skillAppliedAction") : t("productDetail.skillApplyAction")}</Button>
                                    {builtIn ? null : <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(skill.id)} />}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {skill.brand.colors.map((color) => <Tag key={`${skill.id}-${color}`} className="m-0"><span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: color }} />{color}</Tag>)}
                                    {skill.brand.visualTone.map((tone) => <Tag key={`${skill.id}-${tone}`} className="m-0">{tone}</Tag>)}
                                    {skill.copy.tone.map((tone) => <Tag key={`${skill.id}-copy-${tone}`} color="blue" className="m-0">{tone}</Tag>)}
                                    {skill.pagePatterns.length ? <Tag className="m-0">{t("productDetail.skillPatterns", { count: skill.pagePatterns.length })}</Tag> : null}
                                </div>
                            </div>
                        );
                    }) : <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700">{t("productDetail.noSkills")}</div>}
                </div>
            </Modal>

            <Modal
                open={editorOpen}
                centered
                width={680}
                title={editingSkill ? (editingSkill.id.startsWith("builtin-") ? t("productDetail.skillCloneAdjustTitle") : t("productDetail.skillEditTitle")) : t("productDetail.skillCreateTitle")}
                okText={editingSkill ? t("productDetail.skillSaveAction") : t("productDetail.skillCreateAction")}
                cancelText={t("productDetail.skillCancelAction")}
                okButtonProps={{ disabled: !valid }}
                onOk={submit}
                onCancel={() => setEditorOpen(false)}
            >
                <div className="thin-scrollbar max-h-[72vh] space-y-4 overflow-y-auto pr-1 pt-2">
                    <Field label={t("productDetail.skillNameLabel")}><Input value={draft.name} maxLength={64} placeholder={t("productDetail.skillNamePlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
                    <Field label={t("productDetail.skillDescriptionLabel")}><Input.TextArea value={draft.description} maxLength={300} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={t("productDetail.skillDescriptionPlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <Field label={t("productDetail.skillScopeLabel")}>
                        <Select className="w-full" value={draft.scope} options={[
                            { value: "global", label: t("productDetail.skillScopeGlobalOption") },
                            { value: "category", label: t("productDetail.skillScopeCategoryOption") },
                            { value: "platform", label: t("productDetail.skillScopePlatformOption") },
                        ]} onChange={(scope) => setDraft((current) => ({ ...current, scope }))} />
                    </Field>
                    {draft.scope === "category" ? <Field label={t("productDetail.category")}><Input value={draft.category || ""} placeholder={t("productDetail.skillCategoryPlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /></Field> : null}
                    {draft.scope === "platform" ? <Field label={t("productDetail.platform")}><Select className="w-full" value={draft.platform} placeholder={t("productDetail.skillPlatformPlaceholder")} options={[
                        { value: "taobao", label: "淘宝" }, { value: "tmall", label: "天猫" }, { value: "jd", label: "京东" }, { value: "pdd", label: "拼多多" },
                    ]} onChange={(platform) => setDraft((current) => ({ ...current, platform }))} /></Field> : null}
                    <Field label={t("productDetail.skillPatternsLabel")}><Input.TextArea value={draft.patternsText} autoSize={{ minRows: 6, maxRows: 12 }} placeholder={t("productDetail.skillPatternsPlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, patternsText: event.target.value }))} /></Field>
                    <Field label={t("productDetail.skillKnowledgeLabel")}><Input.TextArea value={draft.knowledgeText} autoSize={{ minRows: 3, maxRows: 7 }} placeholder={t("productDetail.skillKnowledgePlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, knowledgeText: event.target.value }))} /></Field>
                    <Field label={t("productDetail.skillForbiddenLabel")}><Input.TextArea value={draft.forbiddenText} autoSize={{ minRows: 2, maxRows: 6 }} placeholder={t("productDetail.skillForbiddenPlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, forbiddenText: event.target.value }))} /></Field>
                    <div className="rounded-xl bg-stone-50 px-3 py-2 text-[10px] leading-5 text-stone-500 dark:bg-white/[0.04] dark:text-stone-400">{t("productDetail.skillCustomHint")}</div>
                </div>
            </Modal>
        </>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>{children}</label>;
}

function lines(value: string) {
    return Array.from(new Set(value.split(/\n+/).map((item) => item.trim()).filter(Boolean)));
}

function parsePagePatterns(value: string): UserDesignSkill["pagePatterns"] {
    return value.split(/\n+/).flatMap((line) => {
        const match = line.match(/^\s*(首屏|痛点|利益|细节|场景|步骤|规格|信任|收尾)\s*[:：]\s*(.+)$/);
        if (!match) return [];
        const field = ROLE_FIELDS.find((item) => item.label === match[1]);
        return field ? [{ role: field.role, guidance: match[2].trim() }] : [];
    });
}
function SkillEnabledToggle({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
    const { t } = useTranslation();
    const stateLabel = enabled ? t("productDetail.skillEnabledState") : t("productDetail.skillDisabledState");
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${label}: ${stateLabel}`}
            data-skill-state={enabled ? "on" : "off"}
            onClick={() => onChange(!enabled)}
            className="group flex shrink-0 items-center gap-1.5 rounded-full p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
            <span className={`relative h-6 w-11 rounded-full border transition-colors ${enabled ? "border-emerald-300/70 bg-emerald-500" : "border-stone-400/50 bg-stone-300 dark:border-stone-600 dark:bg-stone-700"}`}>
                <span className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.28)] transition-transform duration-200 ${enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </span>
            <span className={`min-w-9 text-[10px] font-semibold ${enabled ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400 dark:text-stone-500"}`}>{stateLabel}</span>
        </button>
    );
}
