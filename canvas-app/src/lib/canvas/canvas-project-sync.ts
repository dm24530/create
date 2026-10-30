import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData } from "../../types/canvas";
import type { CanvasDeletedProject, CanvasProject } from "../../stores/canvas/use-canvas-store";
import { canvasProjectCloudFingerprint } from "./canvas-cloud-content";

export type CanvasProjectReconcileResult = {
    project: CanvasProject;
    source: "cloud" | "local" | "merge";
    shouldUpload: boolean;
};

export function isCanvasProjectDeleted(
    projectId: string,
    deletedProjects: CanvasDeletedProject[],
) {
    return deletedProjects.some((item) => item.id === projectId);
}

export function hasUnsyncedCanvasChanges(project: CanvasProject) {
    if (!project.cloudVersion) return true;
    // Legacy projects before fingerprinting cannot prove local changes. Prefer
    // the cloud snapshot instead of overwriting it during migration.
    if (!project.cloudSyncedFingerprint) return false;
    return canvasProjectCloudFingerprint(project) !== project.cloudSyncedFingerprint;
}

export function reconcileCanvasProjectOnOpen(
    local: CanvasProject | null,
    cloud: CanvasProject,
): CanvasProjectReconcileResult {
    if (!local) return { project: cloud, source: "cloud", shouldUpload: false };

    const localFingerprint = canvasProjectCloudFingerprint(local);
    const cloudFingerprint = canvasProjectCloudFingerprint(cloud);
    if (localFingerprint === cloudFingerprint) {
        return {
            project: mergeCloudProjectWithLocalMedia(local, cloud),
            source: "cloud",
            shouldUpload: false,
        };
    }

    // Keep non-empty local work when a bad or partial cloud snapshot is empty.
    if (cloud.nodes.length === 0 && local.nodes.length > 0) {
        return {
            project: { ...local, cloudVersion: cloud.cloudVersion, cloudVersionUncertain: false },
            source: "local",
            shouldUpload: true,
        };
    }

    if (!hasUnsyncedCanvasChanges(local)) {
        return {
            project: mergeCloudProjectWithLocalMedia(local, cloud),
            source: "cloud",
            shouldUpload: false,
        };
    }

    if (!local.cloudVersion) {
        return {
            project: mergeCanvasProjectContents(local, cloud),
            source: "merge",
            shouldUpload: true,
        };
    }

    if (local.cloudVersion === cloud.cloudVersion) {
        return {
            project: {
                ...local,
                cloudVersion: cloud.cloudVersion,
                cloudVersionUncertain: false,
            },
            source: "local",
            shouldUpload: true,
        };
    }

    return {
        project: mergeCanvasProjectContents(local, cloud),
        source: "merge",
        shouldUpload: true,
    };
}

export function mergeCanvasProjectContents(
    local: CanvasProject,
    cloud: CanvasProject,
): CanvasProject {
    const cloudNodes = new Map(cloud.nodes.map((node) => [node.id, node]));
    const localNodeIDs = new Set(local.nodes.map((node) => node.id));
    return {
        ...local,
        title: local.title || cloud.title,
        createdAt: local.createdAt || cloud.createdAt,
        updatedAt: new Date().toISOString(),
        nodes: [
            ...local.nodes.map((node) => {
                const cloudNode = cloudNodes.get(node.id);
                return cloudNode ? mergeNodeContents(node, cloudNode) : node;
            }),
            ...cloud.nodes.filter((node) => !localNodeIDs.has(node.id)),
        ],
        connections: mergeConnections(local.connections, cloud.connections),
        chatSessions: mergeChatSessions(local.chatSessions, cloud.chatSessions),
        cloudVersion: cloud.cloudVersion,
        cloudVersionUncertain: false,
        cloudSyncedFingerprint: undefined,
    };
}

export function mergeCloudProjectWithLocalMedia(
    local: CanvasProject,
    cloud: CanvasProject,
): CanvasProject {
    const localByID = new Map(local.nodes.map((node) => [node.id, node]));
    return {
        ...cloud,
        cloudVersionUncertain: false,
        nodes: cloud.nodes.map((cloudNode) => {
            const localNode = localByID.get(cloudNode.id);
            return localNode ? mergeNodeMedia(localNode, cloudNode) : cloudNode;
        }),
    };
}

function mergeNodeContents(local: CanvasNodeData, cloud: CanvasNodeData): CanvasNodeData {
    const localMeta = local.metadata || {};
    const cloudMeta = cloud.metadata || {};
    const localImages = new Map((localMeta.images || []).map((image) => [image.id, image]));
    const cloudImages = new Map((cloudMeta.images || []).map((image) => [image.id, image]));
    const imageIDs = new Set([...localImages.keys(), ...cloudImages.keys()]);
    const images = Array.from(imageIDs).map((id) => {
        const localImage = localImages.get(id);
        const cloudImage = cloudImages.get(id);
        if (!localImage) return cloudImage!;
        if (!cloudImage) return localImage;
        return {
            ...cloudImage,
            ...localImage,
            content: localImage.content || cloudImage.content,
            storageKey: localImage.storageKey || cloudImage.storageKey,
            cloudAssetId: localImage.cloudAssetId || cloudImage.cloudAssetId,
            cloudURL: localImage.cloudURL || cloudImage.cloudURL,
            cloudPreviewURL: localImage.cloudPreviewURL || cloudImage.cloudPreviewURL,
            cloudSourceObjectKey: localImage.cloudSourceObjectKey || cloudImage.cloudSourceObjectKey,
        };
    });
    return {
        ...cloud,
        ...local,
        metadata: {
            ...cloudMeta,
            ...localMeta,
            content: localMeta.content || cloudMeta.content,
            storageKey: localMeta.storageKey || cloudMeta.storageKey,
            cloudAssetId: localMeta.cloudAssetId || cloudMeta.cloudAssetId,
            cloudURL: localMeta.cloudURL || cloudMeta.cloudURL,
            cloudPreviewURL: localMeta.cloudPreviewURL || cloudMeta.cloudPreviewURL,
            cloudSourceObjectKey: localMeta.cloudSourceObjectKey || cloudMeta.cloudSourceObjectKey,
            images,
        },
    };
}

function mergeNodeMedia(local: CanvasNodeData, cloud: CanvasNodeData): CanvasNodeData {
    if (!local.metadata) return cloud;
    const cloudMeta = cloud.metadata || {};
    const localMeta = local.metadata;
    const localImages = new Map((localMeta.images || []).map((image) => [image.id, image]));
    const images = (cloudMeta.images || localMeta.images || []).map((image) => {
        const localImage = localImages.get(image.id);
        if (!localImage) return image;
        return {
            ...image,
            ...localImage,
            content: localImage.content || image.content,
            storageKey: localImage.storageKey || image.storageKey,
            cloudAssetId: image.cloudAssetId || localImage.cloudAssetId,
            cloudURL: image.cloudURL || localImage.cloudURL,
            cloudPreviewURL: image.cloudPreviewURL || localImage.cloudPreviewURL,
            cloudSourceObjectKey: image.cloudSourceObjectKey || localImage.cloudSourceObjectKey,
            cloudSyncState: image.cloudSyncState || localImage.cloudSyncState,
        };
    });
    const cloudPrimaryContent = cloudMeta.images?.find((image) => image.content)?.content || "";
    const localPrimaryContent = localMeta.images?.find((image) => image.content)?.content || "";
    return {
        ...cloud,
        metadata: {
            ...cloudMeta,
            content: localMeta.content || localPrimaryContent || cloudMeta.content || cloudPrimaryContent,
            storageKey: localMeta.storageKey || cloudMeta.storageKey,
            cloudAssetId: cloudMeta.cloudAssetId || localMeta.cloudAssetId,
            cloudURL: cloudMeta.cloudURL || localMeta.cloudURL,
            cloudPreviewURL: cloudMeta.cloudPreviewURL || localMeta.cloudPreviewURL,
            cloudSourceObjectKey: cloudMeta.cloudSourceObjectKey || localMeta.cloudSourceObjectKey,
            images,
        },
    };
}

function mergeConnections(local: CanvasConnection[], cloud: CanvasConnection[]) {
    const connections = new Map(cloud.map((connection) => [connection.id, connection]));
    for (const connection of local) connections.set(connection.id, connection);
    return Array.from(connections.values());
}

function mergeChatSessions(local: CanvasAssistantSession[], cloud: CanvasAssistantSession[]) {
    const sessions = new Map(cloud.map((session) => [session.id, session]));
    for (const session of local) {
        const cloudSession = sessions.get(session.id);
        if (!cloudSession || Date.parse(session.updatedAt) >= Date.parse(cloudSession.updatedAt)) {
            sessions.set(session.id, session);
        }
    }
    return Array.from(sessions.values());
}
