import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  canDownloadImage,
  createImageStudioDownloads,
  imageDownloadFilename,
  imageDownloadMenuPosition,
} from '../imageStudioDownloads'

describe('image studio downloads', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window.URL, 'createObjectURL')
    Reflect.deleteProperty(window.URL, 'revokeObjectURL')
  })

  it('builds a stable filename from the image title and format', () => {
    expect(imageDownloadFilename({
      id: 1,
      title: '生成结果 1',
      src: '',
      meta: '',
      format: 'webp',
    })).toBe('生成结果 1.webp')
    expect(imageDownloadFilename({
      id: 1,
      title: 'result',
      src: '',
      meta: '',
    })).toBe('result.png')
  })

  it('keeps the download menu inside the viewport', () => {
    expect(imageDownloadMenuPosition(2, 3, 1024, 768)).toEqual({
      x: 8,
      y: 8,
    })
    expect(imageDownloadMenuPosition(1020, 760, 1024, 768)).toEqual({
      x: 808,
      y: 682,
    })
  })

  it('allows a pending image to be downloaded once it has an opaque preview', () => {
    expect(canDownloadImage({
      id: 1,
      title: 'pending',
      src: '',
      meta: '',
      pending: true,
    })).toBe(false)
    expect(canDownloadImage({
      id: 1,
      title: 'pending',
      src: '',
      meta: '',
      pending: true,
      previewSrc: '/api/v1/public/image-task-previews/task-1/0',
    })).toBe(true)
  })

  it('falls back to the opaque task preview before the original is persisted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Blob(['preview-bytes'], { type: 'image/png' }),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:download'),
    })
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const reportError = vi.fn()
    const downloads = createImageStudioDownloads({
      downloadingImageIds: ref(new Set<string>()),
      galleryBackedIds: ref(new Set<string>()),
      imageDownloadMenu: ref(null),
      galleryIdForDownload: async () => '',
      fetchGatewayTaskOriginalBlob: async () => {
        throw new Error('original not ready')
      },
      reportError,
      showError: vi.fn(),
    })

    await downloads.downloadImage({
      id: 1,
      title: '生成结果 1',
      src: '',
      meta: '',
      format: 'png',
      gatewayTaskId: 'imgtask_preview',
      pending: true,
      previewSrc: '/api/v1/public/image-task-previews/imgtask_preview/0',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/public/image-task-previews/imgtask_preview/0',
      expect.objectContaining({ credentials: 'omit', cache: 'no-store' }),
    )
    expect(reportError).not.toHaveBeenCalled()
  })
})
