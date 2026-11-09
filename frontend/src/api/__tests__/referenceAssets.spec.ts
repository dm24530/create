import { afterEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('@/api/client', () => ({
  apiClient: { post },
  buildApiUrl: (path: string) => `/api/v1${path}`,
}))

import { uploadReferenceAssetBlob } from '../referenceAssets'

afterEach(() => {
  post.mockReset()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('reference asset upload', () => {
  it('uses the presigned direct upload path when R2 CORS permits it', async () => {
    post
      .mockResolvedValueOnce({
        data: {
          object_key: 'user/video-references/a.webp',
          upload_url: 'https://r2.example.com/upload',
          upload_headers: { 'Content-Type': 'image/webp' },
          content_type: 'image/webp',
        },
      })
      .mockResolvedValueOnce({
        data: { url: 'https://r2.example.com/read' },
      })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

    await expect(uploadReferenceAssetBlob(
      'image',
      new Blob(['compressed'], { type: 'image/webp' }),
      'image/webp',
    )).resolves.toBe('https://r2.example.com/read')

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/video-studio/reference-assets/presign',
      expect.anything(),
      expect.anything(),
    )
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/video-studio/reference-assets/complete',
      expect.anything(),
      expect.anything(),
    )
  })

  it('falls back to raw multipart when the direct R2 request is blocked', async () => {
    localStorage.setItem('auth_token', 'jwt')
    post.mockResolvedValueOnce({
      data: {
        object_key: 'user/video-references/a.webp',
        upload_url: 'https://r2.example.com/upload',
        upload_headers: { 'Content-Type': 'image/webp' },
        content_type: 'image/webp',
      },
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { url: 'https://r2.example.com/fallback' } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadReferenceAssetBlob(
      'image',
      new Blob(['compressed'], { type: 'image/webp' }),
      'image/webp',
    )).resolves.toBe('https://r2.example.com/fallback')

    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/v1/video-studio/reference-assets/upload')
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData)
  })
})
