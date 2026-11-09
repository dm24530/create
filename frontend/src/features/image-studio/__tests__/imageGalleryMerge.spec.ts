import { describe, expect, it } from 'vitest'
import { mergeImageGallery } from '../imageGalleryMerge'
import type { GeneratedImage } from '../imageStudioTypes'

function localImage(overrides: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'local-1',
    title: 'result',
    src: 'https://cdn.example.com/image.png?signature=old',
    meta: 'PNG',
    pending: false,
    taskId: 'task-1',
    displayOrder: 1_000,
    saved: false,
    ...overrides,
  }
}

describe('image gallery merge', () => {
  it('attaches gallery identity without reloading a rotated signed URL', () => {
    const image = localImage({
      gallerySourceId: 'image-task:task-1:0',
    })
    const result = mergeImageGallery([image], [{
      id: 'gallery-1',
      source_id: 'image-task:task-1:0',
      url: 'https://cdn.example.com/image.png?signature=new',
      sort_order: 1_900,
      saved: true,
    }], {
      localToGalleryId: new Map(),
      locallySavedGalleryIds: new Set(),
      createGalleryImage: () => localImage({ id: 'gallery-card' }),
    })

    expect(result.images[0].galleryId).toBe('gallery-1')
    expect(result.matchedImageGalleryIds.get('local-1')).toBe('gallery-1')
    expect(result.images[0].src).toBe('https://cdn.example.com/image.png?signature=old')
    expect(result.changedMediaIds.size).toBe(0)
  })

  it('reports a media reload when the stored object path changes', () => {
    const image = localImage({
      gallerySourceId: 'image-task:task-1:0',
    })
    const result = mergeImageGallery([image], [{
      id: 'gallery-1',
      source_id: 'image-task:task-1:0',
      url: 'https://cdn.example.com/replacement.png',
      saved: true,
    }], {
      localToGalleryId: new Map(),
      locallySavedGalleryIds: new Set(),
      createGalleryImage: () => localImage({ id: 'gallery-card' }),
    })

    expect(result.images[0].src).toBe('https://cdn.example.com/replacement.png')
    expect(result.changedMediaIds.has('local-1')).toBe(true)
  })

  it('keeps the slot assigned at submission time', () => {
    const image = localImage({ displayOrder: 1_000 })
    const result = mergeImageGallery([image], [{
      id: 'gallery-1',
      source_id: 'image-task:task-1:0',
      url: image.src,
      sort_order: 9_999,
      saved: true,
    }], {
      localToGalleryId: new Map(),
      locallySavedGalleryIds: new Set(),
      createGalleryImage: () => localImage({ id: 'gallery-card' }),
    })

    expect(result.images[0].displayOrder).toBe(1_000)
  })

  it('does not duplicate a locally saved gallery entry', () => {
    const result = mergeImageGallery([localImage({ galleryId: 'gallery-1' })], [{
      id: 'gallery-1',
      url: 'https://cdn.example.com/image.png',
    }], {
      localToGalleryId: new Map(),
      locallySavedGalleryIds: new Set(['gallery-1']),
      createGalleryImage: () => localImage({ id: 'duplicate' }),
    })

    expect(result.images).toHaveLength(1)
    expect(result.images[0].id).toBe('local-1')
  })

  it('adds a new historical image in stable display order', () => {
    const result = mergeImageGallery([localImage({ displayOrder: 2_000 })], [{
      id: 'gallery-2',
      url: 'https://cdn.example.com/history.png',
      sort_order: 1_000,
    }], {
      localToGalleryId: new Map(),
      locallySavedGalleryIds: new Set(),
      createGalleryImage: (entry) => localImage({
        id: entry.id,
        title: 'history',
        src: entry.url || '',
        displayOrder: entry.sort_order as number,
      }),
    })

    expect(result.images.map((image) => image.id)).toEqual([
      'local-1',
      'gallery-2',
    ])
  })
})
