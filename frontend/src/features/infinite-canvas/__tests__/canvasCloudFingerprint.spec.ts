import { describe, expect, it } from 'vitest'

import {
  hashCanvasGraph,
  stableCanvasGraph,
} from '../../../../../canvas-app/src/lib/canvas/canvas-cloud-fingerprint'
import { canvasProjectCloudFingerprint } from '../../../../../canvas-app/src/lib/canvas/canvas-cloud-content'

function project() {
  return {
    id: 'project-a',
    title: 'Project A',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    nodes: [
      {
        id: 'node-a',
        type: 'text',
        position: { x: 10, y: 20 },
        width: 320,
        height: 180,
        title: 'Text',
        metadata: { content: 'hello', fontSize: 16 },
      },
    ],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: 'lines' as const,
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    cloudVersion: 7,
  }
}

describe('canvas cloud fingerprint', () => {
  it('matches the same canvas content regardless of object key order', () => {
    const first = project()
    const second = project()
    second.nodes[0] = {
      title: second.nodes[0].title,
      height: second.nodes[0].height,
      width: second.nodes[0].width,
      position: second.nodes[0].position,
      type: second.nodes[0].type,
      id: second.nodes[0].id,
      metadata: { fontSize: 16, content: 'hello' },
    } as any

    expect(hashCanvasGraph(first)).toBe(hashCanvasGraph(second))
  })

  it('changes when real canvas content changes', () => {
    const first = project()
    const second = project()
    second.nodes[0].title = 'Changed'

    expect(hashCanvasGraph(first)).not.toBe(hashCanvasGraph(second))
  })

  it('treats object key order as stable for cloud snapshots', () => {
    expect(hashCanvasGraph({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(hashCanvasGraph({ a: { c: 3, d: 4 }, b: 2 }))
  })

  it('ignores updatedAt when deciding whether canvas content changed', () => {
    const first = stableCanvasGraph({ nodes: [], viewport: { x: 0, y: 0, k: 1 }, updatedAt: '2026-10-27T00:00:00.000Z' })
    const second = stableCanvasGraph({ nodes: [], viewport: { x: 0, y: 0, k: 1 }, updatedAt: '2026-10-27T01:00:00.000Z' })

    expect(hashCanvasGraph(first)).toBe(hashCanvasGraph(second))
  })

  it('includes the project title in the cloud content fingerprint', () => {
    const first = project()
    const second = { ...project(), title: 'Renamed Project' }

    expect(canvasProjectCloudFingerprint(first)).not.toBe(canvasProjectCloudFingerprint(second))
  })

  it('normalizes local blob media through its cloud URL', () => {
    const first = project() as any
    first.nodes[0] = {
      id: 'image-a',
      type: 'image',
      title: 'Image',
      position: { x: 0, y: 0 },
      width: 640,
      height: 480,
      metadata: {
        content: 'blob:local-preview',
        cloudURL: 'https://cdn.example.com/image.png',
        cloudPreviewURL: 'https://cdn.example.com/thumb.png',
        images: [],
      },
    }
    const second = structuredClone(first)
    second.nodes[0].metadata.content = 'blob:different-local-preview'

    expect(canvasProjectCloudFingerprint(first)).toBe(canvasProjectCloudFingerprint(second))
  })
})
