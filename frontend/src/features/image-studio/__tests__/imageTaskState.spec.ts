import { describe, expect, it } from 'vitest'
import {
  imageTaskIdentity,
  imageTaskSlotIdentity,
  isImageTaskActive,
  isImageTaskDisplayReady,
  resolveImageTaskPhase,
} from '../imageTaskState'

describe('image task state', () => {
  it('treats a failed task as terminal even when stale pending flags remain', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      failed: true,
      error: 'upstream failed',
      pending: true,
      taskId: 'task-1',
    })).toBe('failed')
  })

  it('marks an unconfirmed gateway submission as uncertain', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      pending: true,
      taskId: 'task-1',
      gatewaySubmitPending: true,
    })).toBe('uncertain')
  })

  it('prefers a renderable preview while persistence is still pending', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      pending: true,
      taskId: 'task-1',
      previewSrc: 'blob:preview',
    })).toBe('preview_ready')
  })

  it('marks an accepted task without a preview as generating', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      pending: true,
      taskId: 'task-1',
    })).toBe('generating')
  })

  it('marks a queued request without an accepted task as submitted', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      pending: true,
    })).toBe('submitted')
  })

  it('marks a saved terminal result as persisted', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      src: 'https://cdn.example.com/image.png',
      saved: true,
      galleryId: 'gallery-1',
    })).toBe('persisted')
  })

  it('keeps a terminal unsaved result displayable', () => {
    expect(resolveImageTaskPhase({
      id: 'local-1',
      src: 'https://cdn.example.com/image.png',
      saved: false,
    })).toBe('preview_ready')
  })

  it('counts submitted, generating, uncertain, and pending preview work as active', () => {
    expect(isImageTaskActive({ id: 1, pending: true })).toBe(true)
    expect(isImageTaskActive({ id: 2, pending: true, taskId: 'task-2' })).toBe(true)
    expect(isImageTaskActive({
      id: 3,
      pending: true,
      taskId: 'task-3',
      gatewaySubmitPending: true,
    })).toBe(true)
    expect(isImageTaskActive({
      id: 4,
      pending: true,
      taskId: 'task-4',
      previewSrc: 'blob:preview',
    })).toBe(true)
    expect(isImageTaskActive({ id: 5, failed: true, pending: true })).toBe(false)
    expect(isImageTaskActive({ id: 6, src: 'https://cdn.example.com/image.png' })).toBe(false)
  })

  it('reports display readiness for previews and terminal results', () => {
    expect(isImageTaskDisplayReady({
      id: 1,
      pending: true,
      previewSrc: 'blob:preview',
    })).toBe(true)
    expect(isImageTaskDisplayReady({
      id: 2,
      src: 'https://cdn.example.com/image.png',
    })).toBe(true)
    expect(isImageTaskDisplayReady({ id: 3, pending: true, taskId: 'task-3' })).toBe(false)
    expect(isImageTaskDisplayReady({ id: 4, failed: true, pending: true })).toBe(false)
  })

  it('uses the most durable available task identity', () => {
    expect(imageTaskIdentity({
      id: 'local-1',
      taskId: 'persistent-task',
      gatewayTaskId: 'gateway-task',
      galleryId: 'gallery-1',
    })).toBe('gateway-task')
    expect(imageTaskIdentity({
      id: 'local-1',
      taskId: 'persistent-task',
      galleryId: 'gallery-1',
    })).toBe('persistent-task')
    expect(imageTaskIdentity({ id: 'local-1', galleryId: 'gallery-1' })).toBe('gallery-1')
    expect(imageTaskIdentity({ id: 'local-1' })).toBe('local-1')
  })

  it('keeps a stable slot identity independent of completion order', () => {
    const image = { id: 'local-1', taskId: 'task-1' }
    expect(imageTaskSlotIdentity(image, 2)).toBe('task-1:2')
    expect(imageTaskSlotIdentity(image, 2)).toBe(imageTaskSlotIdentity(image, 2))
  })
})
