import type { CanvasDeletedProject, CanvasProject } from "../../stores/canvas/use-canvas-store";
import { reconcileCanvasProjectOnOpen } from "./canvas-project-sync";

export type CanvasProjectMergeInput = {
    localProjects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    cloudProjects: CanvasProject[];
};

export type CanvasProjectMergeResult = {
    projects: CanvasProject[];
    reuploadProjectIds: string[];
    deletedCloudProjectIds: string[];
};

function updatedAtMs(project: CanvasProject) {
    return Date.parse(project.updatedAt || "") || 0;
}

/**
 * Merges a cloud snapshot into local state without treating a missing or
 * partial cloud list as an instruction to delete local user work.
 */
export function mergeCloudCanvasProjects(input: CanvasProjectMergeInput): CanvasProjectMergeResult {
    const deletedIds = new Set(input.deletedProjects.map((item) => item.id));
    const cloudByID = new Map(input.cloudProjects.map((project) => [project.id, project]));
    const byID = new Map(input.localProjects.map((project) => [project.id, project]));
    const reuploadProjectIds: string[] = [];
    const deletedCloudProjectIds: string[] = [];

    for (const cloudProject of input.cloudProjects) {
        if (deletedIds.has(cloudProject.id)) {
            deletedCloudProjectIds.push(cloudProject.id);
            continue;
        }

        const localProject = byID.get(cloudProject.id);
        if (!localProject) {
            byID.set(cloudProject.id, cloudProject);
            continue;
        }

        const reconciled = reconcileCanvasProjectOnOpen(localProject, cloudProject);
        byID.set(cloudProject.id, reconciled.project);
        if (reconciled.shouldUpload && !reuploadProjectIds.includes(cloudProject.id)) {
            reuploadProjectIds.push(cloudProject.id);
        }
    }

    for (const localProject of input.localProjects) {
        if (!cloudByID.has(localProject.id)) {
            const previouslySynced =
                (typeof localProject.cloudVersion === "number" && localProject.cloudVersion > 0) ||
                Boolean(localProject.cloudSyncedAt);
            if (previouslySynced) {
                byID.delete(localProject.id);
                continue;
            }
            reuploadProjectIds.push(localProject.id);
            byID.set(localProject.id, { ...localProject, cloudVersion: undefined });
        }
    }

    return {
        projects: Array.from(byID.values()).sort((left, right) => updatedAtMs(right) - updatedAtMs(left)),
        reuploadProjectIds,
        deletedCloudProjectIds,
    };
}
