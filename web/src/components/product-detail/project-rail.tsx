import { PackageSearch, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Tag, Tooltip } from "antd";
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
    return (
        <aside className="flex min-h-0 w-[260px] shrink-0 flex-col border-r border-stone-200 bg-white/70 dark:border-stone-800 dark:bg-stone-950/40">
            <div className="border-b border-stone-200 p-4 dark:border-stone-800">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><PackageSearch className="size-4" /></span>
                    <div className="min-w-0"><div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("productDetail.title")}</div><div className="truncate text-xs text-stone-500 dark:text-stone-400">{t("productDetail.subtitle")}</div></div>
                </div>
                <Button type="primary" block icon={<Plus className="size-4" />} className="mt-4" onClick={onCreate}>{t("productDetail.newProject")}</Button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{t("productDetail.brief")}</div>
                {projects.length ? projects.map((project) => (
                    <div key={project.id} role="button" tabIndex={0} className={`group mb-1 flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${project.id === activeProjectId ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950" : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"}`} onClick={() => onSelect(project.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(project.id); } }}>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{project.name}</span><span className={`mt-0.5 block truncate text-[11px] ${project.id === activeProjectId ? "text-white/65 dark:text-stone-950/60" : "text-stone-500"}`}>{project.brief.productName || project.brief.category || t("productDetail.notReady")}</span></span>
                        <span className="opacity-0 transition group-hover:opacity-100"><Tooltip title={t("common.delete")}><Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={(event) => { event.stopPropagation(); onDelete(project.id); }} /></Tooltip></span>
                    </div>
                )) : <div className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs leading-5 text-stone-500 dark:border-stone-700">{t("productDetail.emptyProjects")}<br />{t("productDetail.emptyProjectsHint")}</div>}
                <div className="mt-5 flex items-center justify-between px-2"><div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t("productDetail.skills")}</div><Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={onOpenSkills} /></div>
                <div className="mt-2 space-y-1.5">{skills.length ? skills.slice(0, 6).map((skill) => (
                    <button key={skill.id} type="button" onClick={onOpenSkills} className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-left hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700"><Sparkles className="size-3.5 text-orange-500" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-stone-700 dark:text-stone-300">{skill.name}</span><Tag className="m-0 shrink-0 text-[10px]" color={skill.enabled ? "green" : "default"}>{skill.enabled ? "ON" : "OFF"}</Tag></button>
                )) : <div className="rounded-lg border border-dashed border-stone-200 p-3 text-center text-xs text-stone-500 dark:border-stone-800">{t("productDetail.noSkills")}</div>}</div>
                <p className="mt-2 px-2 text-[11px] leading-5 text-stone-500">{t("productDetail.skillHint")}</p>
            </div>
        </aside>
    );
}


