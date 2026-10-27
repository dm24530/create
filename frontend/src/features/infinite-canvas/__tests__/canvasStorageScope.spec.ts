import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('canvas storage scope migration', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState({}, '', '/canvas?scope=scope12345678&user=101')
  })

  it('does not claim unscoped legacy work for a signed-in user', async () => {
    const { legacyCanvasStorageKeys } = await import(
      '../../../../../canvas-app/src/lib/canvas-storage-scope'
    )

    expect(legacyCanvasStorageKeys('infinite-canvas:canvas_store')).toEqual([
      'infinite-canvas:canvas_store:user:101',
    ])
  })
})
