import { describe, expect, it } from 'vitest'
import {
  galleryIdFor,
  imageGallerySourceID,
} from '../imageGalleryActions'

describe('image gallery actions', () => {
  it('prefers persisted gallery identity over the local card id', () => {
    expect(galleryIdFor({ id: 'local-1', galleryId: 'gallery-2' }, new Map())).toBe('gallery-2')
    expect(galleryIdFor({ id: 'local-1' }, new Map([['local-1', 'gallery-1']]))).toBe('gallery-1')
    expect(galleryIdFor({ id: 'local-1' }, new Map())).toBe('local-1')
  })

  it('derives the stable gallery source identity from the task', () => {
    expect(imageGallerySourceID({
      id: 'local-1',
      gatewayTaskId: 'gateway-1',
      taskId: 'task-1',
    })).toBe('image-task:gateway-1:0')
    expect(imageGallerySourceID({
      id: 'local-1',
      taskId: 'task-1',
      gallerySourceId: 'existing-source',
    })).toBe('image-task:task-1:0')
    expect(imageGallerySourceID({
      id: 'local-1',
      gallerySourceId: 'existing-source',
    })).toBe('existing-source')
  })
})
