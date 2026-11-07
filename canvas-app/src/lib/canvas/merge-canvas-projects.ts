import type { CanvasDeletedProject, CanvasProject } from "../../stores/canvas/use-canvas-store";
import { hasUnsyncedCanvasChanges, reconcileCanvasProjectOnOpen } from "./canvas-project-sync";

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

export type CloudCanvasProjectSummary = {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
  node_count?: number;
  connection_count?: number;
};

export type CanvasProjectSummaryMergeInput = {
  localProjects: CanvasProject[];
  deletedProjects: CanvasDeletedProject[];
  cloudProjects: CloudCanvasProjectSummary[];
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

export function mergeCloudCanvasProjectSummaries(
  input: CanvasProjectSummaryMergeInput,
): CanvasProjectMergeResult {
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
      byID.set(cloudProject.id, projectFromCloudSummary(cloudProject));
      continue;
    }

    const localHasGraph = localProject.nodes.length > 0;
    const hasLocalChanges = hasUnsyncedCanvasChanges(localProject);
    const cloudVersionChanged = typeof localProject.cloudVersion === "number"
      && localProject.cloudVersion !== cloudProject.version;
    byID.set(cloudProject.id, {
      ...localProject,
      title: hasLocalChanges ? localProject.title : cloudProject.title || localProject.title,
      updatedAt: hasLocalChanges
        ? localProject.updatedAt
        : newerTimestamp(localProject.updatedAt, cloudProject.updated_at),
      nodeCount: localHasGraph ? localProject.nodes.length : cloudProject.node_count,
      connectionCount: localHasGraph ? localProject.connections.length : cloudProject.connection_count,
      cloudVersionUncertain: hasLocalChanges
        ? cloudVersionChanged || localProject.cloudVersionUncertain
        : localProject.cloudVersionUncertain,
    });
  }

  for (const localProject of input.localProjects) {
    if (cloudByID.has(localProject.id)) continue;
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

  return {
    projects: Array.from(byID.values()).sort((left, right) => updatedAtMs(right) - updatedAtMs(left)),
    reuploadProjectIds,
    deletedCloudProjectIds,
  };
}

function projectFromCloudSummary(project: CloudCanvasProjectSummary): CanvasProject {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    nodeCount: project.node_count ?? 0,
    connectionCount: project.connection_count ?? 0,
    cloudVersion: project.version,
    cloudSyncedAt: project.updated_at,
  };
}

function newerTimestamp(left: string, right: string) {
  return Date.parse(right || "") > Date.parse(left || "") ? right : left;
}
