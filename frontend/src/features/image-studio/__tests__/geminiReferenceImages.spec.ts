import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GEMINI_REFERENCE_MAX_IMAGES,
  GEMINI_REFERENCE_MAX_IMAGE_BYTES,
  GEMINI_REFERENCE_TOTAL_BYTES,
  fitReferenceDimensions,
  prepareGeminiReferenceImages,
  type GeminiReferenceEncoder,
} from '../geminiReferenceImages'

function source(name: string) {
  return {
    name,
    blob: new Blob([name], { type: 'image/png' }),
  }
}

describe('geminiReferenceImages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('preserves aspect ratio when fitting the longest edge', () => {
    expect(fitReferenceDimensions(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024 })
    expect(fitReferenceDimensions(1200, 2400, 768)).toEqual({ width: 384, height: 768 })
    expect(fitReferenceDimensions(640, 480, 2048)).toEqual({ width: 640, height: 480 })
  })

  it('keeps 14 images under the per-image and combined byte budgets', async () => {
    const encoder: GeminiReferenceEncoder = vi.fn(async (_blob, profile) => {
      const bytes = profile.maxEdge >= 1600 ? 800_000 : 700_000
      return {
        blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
        dataUrl: 'data:image/webp;base64,test',
        width: 1024,
        height: 768,
      }
    })
    const onProgress = vi.fn()

    const prepared = await prepareGeminiReferenceImages(
      Array.from({ length: GEMINI_REFERENCE_MAX_IMAGES }, (_, index) => source(`image-${index + 1}.png`)),
      { encoder, onProgress },
    )

    expect(prepared).toHaveLength(GEMINI_REFERENCE_MAX_IMAGES)
    expect(prepared.every((image) => image.bytes <= GEMINI_REFERENCE_MAX_IMAGE_BYTES)).toBe(true)
    expect(prepared.reduce((total, image) => total + image.bytes, 0))
      .toBeLessThan(GEMINI_REFERENCE_TOTAL_BYTES)
    expect(onProgress).toHaveBeenLastCalledWith(GEMINI_REFERENCE_MAX_IMAGES, GEMINI_REFERENCE_MAX_IMAGES)
  })

  it('fails before submission when the smallest profile still exceeds the total budget', async () => {
    const encoder: GeminiReferenceEncoder = vi.fn(async () => ({
      blob: new Blob([new Uint8Array(900_000)], { type: 'image/webp' }),
      dataUrl: 'data:image/webp;base64,test',
      width: 640,
      height: 480,
    }))

    await expect(prepareGeminiReferenceImages(
      Array.from({ length: GEMINI_REFERENCE_MAX_IMAGES }, (_, index) => source(`image-${index + 1}.png`)),
      { encoder },
    )).rejects.toThrow('14')
  })

  it('encodes 14 proportional WebP images through the browser compression path', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 4096,
      height: 2048,
      close,
    }))
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`unexpected element: ${tagName}`)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
          drawImage: vi.fn(),
        }),
        toBlob: (callback: BlobCallback, mimeType: string, quality = 0.88) => {
          const bytes = Math.round(canvas.width * canvas.height * quality * 0.3)
          queueMicrotask(() => callback(new Blob([new Uint8Array(bytes)], { type: mimeType })))
        },
      }
      return canvas as unknown as HTMLCanvasElement
    }) as typeof document.createElement)

    const prepared = await prepareGeminiReferenceImages(
      Array.from({ length: GEMINI_REFERENCE_MAX_IMAGES }, (_, index) => source(`image-${index + 1}.png`)),
    )

    expect(prepared).toHaveLength(GEMINI_REFERENCE_MAX_IMAGES)
    expect(prepared.every((image) => image.width === 2048 && image.height === 1024)).toBe(true)
    expect(prepared.every((image) => image.dataUrl.startsWith('data:image/webp;base64,'))).toBe(true)
    expect(prepared.reduce((total, image) => total + image.bytes, 0))
      .toBeLessThan(GEMINI_REFERENCE_TOTAL_BYTES)
    expect(close).toHaveBeenCalledTimes(GEMINI_REFERENCE_MAX_IMAGES)
  })
})
