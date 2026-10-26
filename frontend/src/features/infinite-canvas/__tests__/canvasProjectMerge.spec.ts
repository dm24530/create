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
})
