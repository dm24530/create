import type { ProductDetailProject, ProductDetailWorkspace, UserDesignSkill } from "@/types/product-detail";
import { createEmptyWorkspace as createWorkspace } from "@/lib/product-detail/defaults";

export { createEmptyWorkspace } from "@/lib/product-detail/defaults";

export function upsertProject(workspace: ProductDetailWorkspace, project: ProductDetailProject): ProductDetailWorkspace {
    const index = workspace.projects.findIndex((item) => item.id === project.id);
    const projects = index >= 0
        ? workspace.projects.map((item) => (item.id === project.id ? project : item))
        : [project, ...workspace.projects];
    return {
        ...workspace,
        projects: projects.sort((a, b) => b.updatedAt - a.updatedAt),
        activeProjectId: project.id,
        updatedAt: Date.now(),
    };
}

export function removeProject(workspace: ProductDetailWorkspace, projectId: string): ProductDetailWorkspace {
    return {
        ...workspace,
        projects: workspace.projects.filter((item) => item.id !== projectId),
        activeProjectId: workspace.activeProjectId === projectId ? undefined : workspace.activeProjectId,
        updatedAt: Date.now(),
    };
}

export function selectProject(workspace: ProductDetailWorkspace, projectId: string): ProductDetailWorkspace {
    if (!workspace.projects.some((item) => item.id === projectId)) return workspace;
    return { ...workspace, activeProjectId: projectId, updatedAt: Date.now() };
}

export function upsertSkill(workspace: ProductDetailWorkspace, skill: UserDesignSkill): ProductDetailWorkspace {
    const index = workspace.skills.findIndex((item) => item.id === skill.id);
    const skills = index >= 0
        ? workspace.skills.map((item) => (item.id === skill.id ? skill : item))
        : [skill, ...workspace.skills];
    return { ...workspace, skills, updatedAt: Date.now() };
}

export function removeSkill(workspace: ProductDetailWorkspace, skillId: string): ProductDetailWorkspace {
    return {
        ...workspace,
        skills: workspace.skills.filter((item) => item.id !== skillId),
        projects: workspace.projects.map((project) => ({
            ...project,
            skillIds: project.skillIds.filter((id) => id !== skillId),
        })),
        updatedAt: Date.now(),
    };
}

export function normalizeWorkspace(value: unknown): ProductDetailWorkspace {
    if (!value || typeof value !== "object") return createWorkspace();
    const raw = value as Partial<ProductDetailWorkspace>;
    return {
        version: Number(raw.version) || 1,
        projects: Array.isArray(raw.projects) ? raw.projects.filter(Boolean) as ProductDetailProject[] : [],
        skills: Array.isArray(raw.skills) ? raw.skills.filter(Boolean) as UserDesignSkill[] : [],
        activeProjectId: typeof raw.activeProjectId === "string" ? raw.activeProjectId : undefined,
        updatedAt: Number(raw.updatedAt) || Date.now(),
    };
}
