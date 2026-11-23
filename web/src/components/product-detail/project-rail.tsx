import { useState } from "react";
import { ChevronDown, ChevronRight, PackageSearch, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import type { ProductDetailProject, UserDesignSkill } from "@/types/product-detail";

export function ProjectRail({ projects, skills, activeProjectId, onSelect, onCreate, onDelete, onOpenSkills }: {
    projects: ProductDetailProject[];
    skills: UserDesignSkill[];
    activeProjectId?: string;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
    onOpenSkills: () => void;
}) {
    const { t } = useTranslation();
    const [skillsExpanded, setSkillsExpanded] = useState(false);
    return (
        <aside className="flex min-h-0 w-[244px] shrink-0 flex-col border-r border-black/[0.06] bg-[#f1efe9] text-[#22211f] dark:border-white/[0.07] dark:bg-[#181613] dark:text-stone-100">
            <div className="px-4 pb-4 pt-5">
                <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[#22211f] text-white shadow-[0_8px_22px_rgba(34,33,31,0.16)] dark:bg-stone-100 dark:text-stone-950">
                        <PackageSearch className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">Create</div>
                        <div className="mt-0.5 truncate text-sm font-semibold tracking-[-0.025em]">{t("productDetail.title")}</div>
                    </div>
                </div>
                <Button
                    block
                    icon={<Plus className="size-4" />}
                    onClick={onCreate}
                    className="mt-5 h-10 rounded-[14px] border-0 bg-[#22211f] text-xs font-semibold text-white shadow-[0_8px_22px_rgba(34,33,31,0.14)] hover:!bg-black dark:!bg-stone-100 dark:!text-stone-950 dark:hover:!bg-white dark:hover:!text-stone-950"
                >
                    {t("productDetail.newProject")}
                </Button>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
                <div className="mb-2 flex items-center justify-between px-2.5 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">最近项目</span>
                    <span className="text-[10px] text-stone-400 dark:text-stone-600">{projects.length}</span>
                </div>
                {projects.length ? projects.map((project) => {
                    const active = project.id === activeProjectId;
                    return (
                        <div
                            key={project.id}
                            role="button"
                            tabIndex={0}
                            className={`group mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition ${active ? "border border-black/[0.06] bg-white/85 text-stone-950 shadow-[0_3px_12px_rgba(38,32,25,0.04)] dark:border-white/[0.08] dark:bg-white/[0.07] dark:text-stone-50" : "border border-transparent text-stone-600 hover:bg-white/45 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.04] dark:hover:text-stone-200"}`}
                            onClick={() => onSelect(project.id)}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(project.id); } }}
                        >
                            <span className={`size-2 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"}`} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{project.name}</span>
                                <span className={`mt-0.5 block truncate text-[10px] ${active ? "text-stone-500 dark:text-stone-400" : "text-stone-400 dark:text-stone-500"}`}>{project.brief.productName || project.brief.category || t("productDetail.notReady")}</span>
                            </span>
                            <span className="opacity-0 transition group-hover:opacity-100">
                                <Tooltip title={t("common.delete")}>
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<Trash2 className="size-3.5" />}
                                        onClick={(event) => { event.stopPropagation(); onDelete(project.id); }}
                                        className="size-7 rounded-lg"
                                    />
                                </Tooltip>
                            </span>
                        </div>
                    );
                }) : (
                    <div className="mx-1 rounded-[16px] border border-dashed border-black/[0.1] px-4 py-5 text-center text-[11px] leading-5 text-stone-500 dark:border-white/10 dark:text-stone-400">
                        {t("productDetail.emptyProjects")}
                        <br />
                        {t("productDetail.emptyProjectsHint")}
                    </div>
                )}

                <div className="mb-2 mt-6 flex items-center gap-1.5 px-2.5">
                    <button
                        type="button"
                        data-skill-toggle=""
                        aria-expanded={skillsExpanded}
                        onClick={() => setSkillsExpanded((current) => !current)}
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-lg py-1 text-left text-stone-400 transition hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300"
                    >
                        {skillsExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em]">{t("productDetail.skills")}</span>
                        <span className="ml-auto text-[10px] text-stone-400 dark:text-stone-600">{skills.length}</span>
                    </button>
                    <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={onOpenSkills} className="size-7 rounded-lg text-stone-500" />
                </div>
                <div
                    data-skill-list=""
                    hidden={!skillsExpanded}
                    className="thin-scrollbar max-h-[164px] space-y-1.5 overflow-y-auto px-1 pb-1 pr-2"
                >
                    {skills.length ? skills.map((skill) => (
                        <button
                            key={skill.id}
                            type="button"
                            onClick={onOpenSkills}
                            className="flex w-full items-center gap-2 rounded-[12px] border border-transparent px-2.5 py-2 text-left text-stone-600 transition hover:border-black/[0.05] hover:bg-white/50 hover:text-stone-900 dark:text-stone-400 dark:hover:border-white/[0.06] dark:hover:bg-white/[0.04] dark:hover:text-stone-200"
                        >
                            <Sparkles className="size-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{skill.name}</span>
                            <span className={`size-1.5 rounded-full ${skill.enabled ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"}`} />
                        </button>
                    )) : (
                        <div className="rounded-[12px] border border-dashed border-black/[0.08] px-3 py-4 text-center text-[10px] text-stone-400 dark:border-white/[0.08] dark:text-stone-500">{t("productDetail.noSkills")}</div>
                    )}
                    <p className="px-1.5 py-1.5 text-[10px] leading-5 text-stone-400 dark:text-stone-600">{t("productDetail.skillHint")}</p>
                </div>
            </div>
        </aside>
    );
}
