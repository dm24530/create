import { describe, expect, it } from 'vitest'

import { canvasProjectCloudFingerprint } from '../../../../../canvas-app/src/lib/canvas/canvas-cloud-content'
import {
  hasUnsyncedCanvasChanges,
  reconcileCanvasProjectOnOpen,
} from '../../../../../canvas-app/src/lib/canvas/canvas-project-sync'

function project(id: string, title: string, nodeIds: string[], cloudVersion = 1) {
  const updatedAt = '2026-10-27T00:00:00.000Z'
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    nodes: nodeIds.map((nodeId) => ({
      id: nodeId,
      type: 'text',
      title: nodeId,
      position: { x: 0, y: 0 },
      width: 320,
      height: 180,
      metadata: { content: nodeId },
    })),
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: 'lines' as const,
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    cloudVersion,
  }
}

function synced(projectValue: ReturnType<typeof project>) {
  return {
    ...projectValue,
    cloudSyncedFingerprint: canvasProjectCloudFingerprint(projectValue),
  }
}

describe('canvas project sync reconciliation', () => {
  it('uses newer cloud content when the local project is clean', () => {
    const local = synced(project('shared', 'Old title', ['local-node'], 1))
    const cloud = project('shared', 'Cloud title', ['cloud-node'], 2)

    const result = reconcileCanvasProjectOnOpen(local, cloud)

    expect(result.source).toBe('cloud')
    expect(result.shouldUpload).toBe(false)
    expect(result.project.title).toBe('Cloud title')
    expect(result.project.nodes.map((node) => node.id)).toEqual(['cloud-node'])
  })

  it('merges local unsynced changes with remote-only additions', () => {
    const base = synced(project('shared', 'Local title', ['local-node'], 1))
    const local = {
      ...base,
      title: 'Local title changed',
      updatedAt: '2026-10-27T01:00:00.000Z',
    }
    const cloud = project('shared', 'Cloud title', ['cloud-node'], 2)

    expect(hasUnsyncedCanvasChanges(local)).toBe(true)

    const result = reconcileCanvasProjectOnOpen(local, cloud)

    expect(result.source).toBe('merge')
    expect(result.shouldUpload).toBe(true)
    expect(result.project.title).toBe('Local title changed')
    expect(result.project.nodes.map((node) => node.id)).toEqual(['local-node', 'cloud-node'])
    expect(result.project.cloudVersion).toBe(2)
    expect(result.project.cloudSyncedFingerprint).toBeUndefined()
  })

  it('does not replace non-empty local work with an empty cloud snapshot', () => {
    const local = synced(project('shared', 'Local title', ['local-node'], 2))
    const cloud = project('shared', 'Cloud title', [], 3)

    const result = reconcileCanvasProjectOnOpen(local, cloud)

    expect(result.source).toBe('local')
    expect(result.shouldUpload).toBe(true)
    expect(result.project.nodes.map((node) => node.id)).toEqual(['local-node'])
  })

  it('treats a title change as an unsynced canvas change', () => {
    const local = synced(project('shared', 'Old title', ['local-node'], 1))
    const renamed = {
      ...local,
      title: 'New title',
      updatedAt: '2026-10-27T01:00:00.000Z',
    }

    expect(hasUnsyncedCanvasChanges(renamed)).toBe(true)
  })
})
