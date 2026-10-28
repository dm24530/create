import { describe, expect, it, vi } from 'vitest'

import {
  canvasChannelName,
  selectCanvasCreatorKey,
  selectCanvasVideoCreatorKey,
} from '../creatorKeySelection'
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

function videoKey(id: number, groupId: number): ApiKey {
  return {
    ...key(id, groupId, false),
    group: {
      ...key(id, groupId, false).group!,
      video_capable: true,
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

  it('uses the selected API key from the current user namespace', () => {
    const preferred = key(2, 20)
    const storage = {
      getItem: vi.fn((key: string) => (
        key === 'sub2api:image-studio:preferences:42'
          ? JSON.stringify({ keyId: '2' })
          : null
      )),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([key(1, 10), preferred], storage, 42)).toBe(preferred)
    expect(storage.getItem).toHaveBeenCalledWith('sub2api:image-studio:preferences:42')
  })

  it('falls back when the saved key cannot generate images', () => {
    const blocked = key(2, 20, false)
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ keyId: '2' })),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([key(1, 10), blocked], storage)?.id).toBe(1)
  })

  it('automatically selects a composite key when no selection is saved', () => {
    const composite = {
      ...key(1, 10),
      group: { ...key(1, 10).group!, platform: 'composite' },
    } as ApiKey
    const regular = key(2, 20)
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([regular, composite], storage)).toBe(composite)
  })

  it('returns null only when no active image-capable key exists', () => {
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Storage

    expect(selectCanvasCreatorKey([key(1, 10, false)], storage)).toBeNull()
  })

  it('uses the selected API key name as the managed channel name', () => {
    expect(canvasChannelName(key(7, 30))).toBe('Key 7')
  })
})

describe('selectCanvasVideoCreatorKey', () => {
  it('uses the video studio selected API key from the current user namespace', () => {
    const preferred = videoKey(3, 30)
    const storage = {
      getItem: vi.fn((storageKey: string) => (
        storageKey === 'sub2api:video-studio:preferences:42'
          ? JSON.stringify({ keyId: '3' })
          : null
      )),
    } as unknown as Storage

    expect(selectCanvasVideoCreatorKey([key(1, 10), preferred], storage, 42)).toBe(preferred)
    expect(storage.getItem).toHaveBeenCalledWith('sub2api:video-studio:preferences:42')
  })

  it('does not reuse an image-only API key for video', () => {
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Storage

    expect(selectCanvasVideoCreatorKey([key(1, 10), key(2, 20)], storage)).toBeNull()
  })

  it('falls back to an active video-capable key', () => {
    const primary = videoKey(3, 30)
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Storage

    expect(selectCanvasVideoCreatorKey([key(1, 10), primary], storage)).toBe(primary)
  })
})
