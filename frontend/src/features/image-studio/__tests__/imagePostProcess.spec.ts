import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  imageNeedsLocalResize,
  processImageForDisplay,
} from '../imagePostProcess'

describe('imagePostProcess', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('only resizes sizes beyond the upstream edge limit', () => {
    expect(imageNeedsLocalResize('3840x3840', 3840)).toBe(false)
    expect(imageNeedsLocalResize('4096x4096', 3840)).toBe(true)
    expect(imageNeedsLocalResize('1024x4096', 3840)).toBe(true)
    expect(imageNeedsLocalResize('auto', 3840)).toBe(false)
  })

  it('keeps and returns the original image when local processing fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('cors blocked')))

    const result = await processImageForDisplay(
      'https://cdn.example.com/source.png',
      '4096x4096',
      'png',
    )

    expect(result.processed).toBe(false)
    expect(result.src).toBe('https://cdn.example.com/source.png')
    expect(result.error).toContain('cors blocked')
  })

  it('keeps the original bytes when the output already matches the requested size', async () => {
    const close = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['source'], { type: 'image/png' }),
    }))
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 2880,
      height: 2880,
      close,
    }))
    const createElement = vi.spyOn(document, 'createElement')

    const result = await processImageForDisplay(
      'https://cdn.example.com/source.png',
      '2880x2880',
      'png',
    )

    expect(result).toEqual({
      src: 'https://cdn.example.com/source.png',
      format: 'png',
      processed: false,
    })
    expect(createElement).not.toHaveBeenCalledWith('canvas')
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns a processed image only after resizing succeeds', async () => {
    const close = vi.fn()
    const drawImage = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['source'], { type: 'image/png' }),
    }))
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 3840,
      height: 3840,
      close,
    }))
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`unexpected element: ${tagName}`)
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '',
          fillRect: vi.fn(),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
          drawImage,
        }),
        toDataURL: () => 'data:image/png;base64,processed',
      } as unknown as HTMLCanvasElement
    }) as typeof document.createElement)

    const result = await processImageForDisplay(
      'https://cdn.example.com/source.png',
      '4096x4096',
      'png',
    )

    expect(result).toEqual({
      src: 'data:image/png;base64,processed',
      format: 'png',
      processed: true,
    })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4096, 4096)
    expect(close).toHaveBeenCalledOnce()
  })
})
