import { describe, expect, it, vi } from 'vitest'

import { canvasChannelName, selectCanvasCreatorKey } from '../creatorKeySelection'
import type { ApiKey } from '@/types'

function key(id: number, groupId: number, allowImage = true): ApiKey {
  return {
    id,
    key: `sk-${id}`,
    name: `Key ${id}`,
    group_id: groupId,
    status: 'active',
    group: {
      id: groupId,
      allow_image_generation: allowImage,
    },
  } as ApiKey
}

describe('selectCanvasCreatorKey', () => {
  it('uses the image studio selected API key', () => {
    const preferred = key(2, 20)
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ keyId: '2' })),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([key(1, 10), preferred], storage)).toBe(preferred)
  })

  it('returns null when the saved key is unavailable or cannot generate images', () => {
    const blocked = key(2, 20, false)
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ keyId: '2' })),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([key(1, 10), blocked], storage)).toBeNull()
  })

  it('does not fall back when no selection is saved', () => {
    const composite = {
      ...key(1, 10),
      group: { ...key(1, 10).group!, platform: 'composite' },
    } as ApiKey
    const regular = key(2, 20)
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([composite, regular], storage)).toBeNull()
  })

  it('uses the selected API key name as the managed channel name', () => {
    expect(canvasChannelName(key(7, 30))).toBe('Key 7')
  })
})
