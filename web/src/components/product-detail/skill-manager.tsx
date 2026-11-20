import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Modal, Switch, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { UserDesignSkill } from "@/types/product-detail";

export function SkillManagerModal({ open, skills, canCreate, onClose, onToggle, onDelete, onCreateFromProject, onAttach }: {
    open: boolean;
    skills: UserDesignSkill[];
    canCreate: boolean;
    onClose: () => void;
    onToggle: (skillId: string, enabled: boolean) => void;
    onDelete: (skillId: string) => void;
    onCreateFromProject: () => void;
    onAttach: (skillId: string) => void;
}) {
    const { t } = useTranslation();
    return (
        <Modal open={open} onCancel={onClose} footer={null} width={680} title={t("productDetail.skills")}>
            <div className="mb-4 flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                <div><div className="text-sm font-medium">{t("productDetail.skillHint")}</div><div className="mt-1 text-xs text-stone-500">Local only · {skills.length} saved</div></div>
                <Button type="primary" icon={<Plus className="size-4" />} disabled={!canCreate} onClick={onCreateFromProject}>{t("productDetail.newSkill")}</Button>
            </div>
            <div className="thin-scrollbar max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {skills.length ? skills.map((skill) => (
                    <div key={skill.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                        <div className="flex items-center gap-3">
                            <Sparkles className="size-4 text-orange-500" />
                            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{skill.name}</div><div className="mt-1 truncate text-xs text-stone-500">{skill.description}</div></div>
                            <Switch size="small" checked={skill.enabled} onChange={(enabled) => onToggle(skill.id, enabled)} />
                            <Button size="small" onClick={() => onAttach(skill.id)}>应用到项目</Button>
                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(skill.id)} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {skill.brand.colors.map((color) => <Tag key={`${skill.id}-${color}`} className="m-0"><span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: color }} />{color}</Tag>)}
                            {skill.brand.visualTone.map((tone) => <Tag key={`${skill.id}-${tone}`} className="m-0">{tone}</Tag>)}
                            {skill.copy.tone.map((tone) => <Tag key={`${skill.id}-copy-${tone}`} color="blue" className="m-0">{tone}</Tag>)}
                        </div>
                    </div>
                )) : <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700">{t("productDetail.noSkills")}</div>}
            </div>
        </Modal>
    );
}
