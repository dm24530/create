import { describe, expect, it } from 'vitest'

import {
  mergeCloudCanvasProjects,
  type CanvasProjectMergeInput,
} from '../../../../../canvas-app/src/lib/canvas/merge-canvas-projects'

function project(id: string, updatedAt: string, nodes = 1, cloudVersion?: number) {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    nodes: Array.from({ length: nodes }, (_, index) => ({ id: `${id}-${index}` })),
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: 'lines' as const,
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    cloudVersion,
  }
}

function input(overrides: Partial<CanvasProjectMergeInput> = {}): CanvasProjectMergeInput {
  return {
    localProjects: [],
    deletedProjects: [],
    cloudProjects: [],
    ...overrides,
  }
}

describe('mergeCloudCanvasProjects', () => {
  it('treats a successful full cloud snapshot as authoritative for previously synced projects', () => {
    const local = project('local-only', '2026-10-26T08:00:00.000Z', 9, 12)

    const result = mergeCloudCanvasProjects(input({ localProjects: [local] }))

    expect(result.projects).toHaveLength(0)
    expect(result.reuploadProjectIds).toEqual([])
  })

  it('does not resurrect a previously synced project that lost its version during migration', () => {
    const local = {
      ...project('local-only', '2026-10-26T08:00:00.000Z', 9),
      cloudSyncedAt: '2026-10-26T08:00:00.000Z',
    }

    const result = mergeCloudCanvasProjects(input({ localProjects: [local] }))

    expect(result.projects).toHaveLength(0)
    expect(result.reuploadProjectIds).toEqual([])
  })

  it('removes a cloud project when a local deletion tombstone exists', () => {
    const cloud = project('deleted-project', '2026-10-26T09:00:00.000Z', 5, 7)

    const result = mergeCloudCanvasProjects(input({
      deletedProjects: [{
        id: 'deleted-project',
        deletedAt: '2026-10-26T10:00:00.000Z',
      }],
      cloudProjects: [cloud],
    }))

    expect(result.projects).toHaveLength(0)
    expect(result.deletedCloudProjectIds).toEqual(['deleted-project'])
  })

  it('keeps and requests reupload for a project that has never reached the cloud', () => {
    const localOnly = project('local-only', '2026-10-26T08:00:00.000Z', 3)
    const stale = project('shared', '2026-10-26T07:00:00.000Z', 1, 4)
    const cloud = project('shared', '2026-10-26T09:00:00.000Z', 5, 7)

    const result = mergeCloudCanvasProjects(input({
      localProjects: [localOnly, stale],
      cloudProjects: [cloud],
    }))

    expect(result.projects.map((item) => item.id)).toEqual(['shared', 'local-only'])
    expect(result.projects[0].nodes).toHaveLength(5)
    expect(result.projects[0].cloudVersion).toBe(7)
    expect(result.projects[1].cloudVersion).toBeUndefined()
    expect(result.reuploadProjectIds).toEqual(['local-only'])
  })

  it('does not replace a non-empty local canvas with a newer empty cloud snapshot', () => {
    const local = project('shared', '2026-10-26T07:00:00.000Z', 3, 4)
    const emptyCloud = project('shared', '2026-10-26T09:00:00.000Z', 0, 5)

    const result = mergeCloudCanvasProjects(input({
      localProjects: [local],
      cloudProjects: [emptyCloud],
    }))

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].nodes).toHaveLength(3)
    expect(result.projects[0].cloudVersion).toBe(5)
  })

  it('clears a keepalive-uncertain version after a full cloud snapshot arrives', () => {
    const local = {
      ...project('shared', '2026-10-26T07:00:00.000Z', 3, 4),
      cloudVersionUncertain: true,
    }
    const cloud = project('shared', '2026-10-26T09:00:00.000Z', 3, 5)

    const result = mergeCloudCanvasProjects(input({
      localProjects: [local],
      cloudProjects: [cloud],
    }))

    expect(result.projects[0].cloudVersion).toBe(5)
    expect(result.projects[0].cloudVersionUncertain).toBe(false)
  })

  it('keeps local media when a newer cloud node has empty content', () => {
    const local = project('shared', '2026-10-26T07:00:00.000Z', 1, 4)
    local.nodes[0] = {
      ...local.nodes[0],
      type: 'image',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      title: 'image',
      metadata: {
        content: 'blob:cached-image',
        storageKey: 'image:cached',
        images: [{ id: 'image-1', status: 'success', content: 'blob:cached-image', storageKey: 'image:cached' }],
        primaryImageId: 'image-1',
      },
    } as any
    const cloud = project('shared', '2026-10-26T09:00:00.000Z', 1, 5)
    cloud.nodes[0] = {
      ...cloud.nodes[0],
      type: 'image',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      title: 'image',
      metadata: {
        content: '',
        images: [{ id: 'image-1', status: 'success', content: '', naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' }],
        primaryImageId: 'image-1',
      },
    } as any

    const result = mergeCloudCanvasProjects(input({
      localProjects: [local],
      cloudProjects: [cloud],
    }))

    expect(result.projects[0].nodes[0].metadata.content).toBe('blob:cached-image')
    expect(result.projects[0].nodes[0].metadata.storageKey).toBe('image:cached')
    expect(result.projects[0].nodes[0].metadata.images?.[0].content).toBe('blob:cached-image')
  })

  it('keeps the local cached image reference when the cloud has the same image', () => {
    const local = project('shared', '2026-10-26T07:00:00.000Z', 1, 4)
    local.nodes[0] = {
      ...local.nodes[0],
      type: 'image',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      title: 'image',
      metadata: {
        content: 'blob:local-image',
        storageKey: 'image:local',
        images: [{ id: 'image-1', status: 'success', content: 'blob:local-image', storageKey: 'image:local' }],
        primaryImageId: 'image-1',
      },
    } as any
    const cloud = project('shared', '2026-10-26T09:00:00.000Z', 1, 5)
    cloud.nodes[0] = {
      ...cloud.nodes[0],
      type: 'image',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      title: 'image',
      metadata: {
        content: 'https://cdn.example.com/cloud-image.png',
        storageKey: 'image:cloud',
        cloudAssetId: 'asset-1',
        images: [{
          id: 'image-1',
          status: 'success',
          content: 'https://cdn.example.com/cloud-image.png',
          storageKey: 'image:cloud',
          cloudAssetId: 'asset-1',
        }],
        primaryImageId: 'image-1',
      },
    } as any

    const result = mergeCloudCanvasProjects(input({
      localProjects: [local],
      cloudProjects: [cloud],
    }))

    expect(result.projects[0].nodes[0].metadata.content).toBe('blob:local-image')
    expect(result.projects[0].nodes[0].metadata.storageKey).toBe('image:local')
    expect(result.projects[0].nodes[0].metadata.images?.[0].storageKey).toBe('image:local')
    expect(result.projects[0].nodes[0].metadata.cloudAssetId).toBe('asset-1')
  })

  it('promotes image entry content when the cloud node root content is empty', () => {
    const local = project('shared', '2026-10-26T07:00:00.000Z', 1, 4)
    local.nodes[0] = {
      ...local.nodes[0],
      type: 'image',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      title: 'image',
      metadata: { content: '', images: [], primaryImageId: 'image-1' },
    } as any
    const cloud = project('shared', '2026-10-26T09:00:00.000Z', 1, 5)
    cloud.nodes[0] = {
      ...cloud.nodes[0],
      type: 'image',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      title: 'image',
      metadata: {
        content: '',
        primaryImageId: 'image-1',
        images: [{ id: 'image-1', status: 'success', content: 'https://cdn.example.com/recovered.png' }],
      },
    } as any

    const result = mergeCloudCanvasProjects(input({
      localProjects: [local],
      cloudProjects: [cloud],
    }))

    expect(result.projects[0].nodes[0].metadata.content).toBe('https://cdn.example.com/recovered.png')
  })

})
