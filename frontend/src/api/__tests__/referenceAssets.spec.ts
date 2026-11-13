import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  buildApiUrl: (path: string) => path.startsWith('/api/v1') ? path : `/api/v1${path}`,
}))

import { uploadReferenceAssetBlob } from '../referenceAssets'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('reference asset upload', () => {
  it('uses the multipart Create endpoint and returns a Create URL', async () => {
    localStorage.setItem('auth_token', 'jwt')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: { url: '/api/v1/public/video-reference-assets/token' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadReferenceAssetBlob(
      'image',
      new Blob(['compressed'], { type: 'image/webp' }),
      'image/webp',
    )).resolves.toBe(`${window.location.origin}/api/v1/public/video-reference-assets/token`)

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/video-studio/reference-assets/upload')
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData)
  })
})
