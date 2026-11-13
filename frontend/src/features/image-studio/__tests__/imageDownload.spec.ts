import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  imageDownloadURL,
  isSafeImagePreviewSource,
  resolveImageAssetURL,
} from '../imageDownload'

describe('imageDownloadURL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('marks local image assets as downloads', () => {
    expect(imageDownloadURL('/api/v1/public/image-assets/abc', 'https://example.com')).toBe(
      'https://example.com/api/v1/public/image-assets/abc?download=1',
    )
  })

  it('marks task previews as downloads through the Create API', () => {
    expect(imageDownloadURL('/api/v1/public/image-task-previews/task-1/0', 'https://example.com')).toBe(
      'https://example.com/api/v1/public/image-task-previews/task-1/0?download=1',
    )
  })

  it('keeps unrelated URLs unchanged', () => {
    expect(imageDownloadURL('https://cdn.example.com/image.png', 'https://example.com')).toBe(
      'https://cdn.example.com/image.png',
    )
  })

  it('resolves local images through the configured API base', () => {
    expect(resolveImageAssetURL('/api/v1/public/image-assets/abc')).toBe(
      '/api/v1/public/image-assets/abc',
    )
  })

  it('resolves local images through an absolute API base', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/api/v1')
    const module = await import('../imageDownload')

    expect(module.resolveImageAssetURL('/api/v1/public/image-assets/abc')).toBe(
      'https://api.example.com/api/v1/public/image-assets/abc',
    )
    expect(module.imageDownloadURL('/api/v1/public/image-assets/abc')).toBe(
      'https://api.example.com/api/v1/public/image-assets/abc?download=1',
    )
    expect(module.resolveImageAssetURL('/api/v1/public/image-task-previews/task-1/0')).toBe(
      'https://api.example.com/api/v1/public/image-task-previews/task-1/0',
    )
  })

  it('only accepts preview sources controlled by Create', () => {
    expect(isSafeImagePreviewSource('/api/v1/public/image-task-previews/task-1/0')).toBe(true)
    expect(isSafeImagePreviewSource('data:image/jpeg;base64,abc')).toBe(true)
    expect(isSafeImagePreviewSource('blob:preview')).toBe(true)
    expect(isSafeImagePreviewSource('https://example.com/image.png', 'https://example.com')).toBe(true)
    expect(isSafeImagePreviewSource('https://cdn.upstream.example/image.png', 'https://example.com')).toBe(false)
    expect(isSafeImagePreviewSource('//cdn.upstream.example/image.png', 'https://example.com')).toBe(false)
  })
})
