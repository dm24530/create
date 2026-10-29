import { describe, expect, it } from 'vitest'

import {
  imageOutputFileExtension,
  imageOutputMimeType,
  normalizeImageBackground,
  normalizeImageOutputFormat,
  supportsTransparentImageBackground,
} from '../../../../../canvas-app/src/lib/image-output-format'

describe('canvas image output format', () => {
  it('normalizes png, jpg, and jpeg values', () => {
    expect(normalizeImageOutputFormat('png')).toBe('png')
    expect(normalizeImageOutputFormat('jpg')).toBe('jpeg')
    expect(normalizeImageOutputFormat('JPEG')).toBe('jpeg')
    expect(normalizeImageOutputFormat('webp')).toBe('png')
  })

  it('reports transparent background support by image model', () => {
    expect(supportsTransparentImageBackground('default::gpt-image-2')).toBe(true)
    expect(supportsTransparentImageBackground('gemini-2.5-flash-image')).toBe(false)
    expect(supportsTransparentImageBackground('google/nano-banana')).toBe(false)
    expect(supportsTransparentImageBackground('grok-imagine-image')).toBe(false)
  })

  it('only keeps transparent background for supported PNG requests', () => {
    expect(normalizeImageBackground('gpt-image-2', 'transparent', 'png')).toBe('transparent')
    expect(normalizeImageBackground('gpt-image-2', 'transparent', 'jpeg')).toBe('')
    expect(normalizeImageBackground('gemini-2.5-flash-image', 'transparent', 'png')).toBe('')
  })

  it('maps output formats to MIME types and file extensions', () => {
    expect(imageOutputMimeType('png')).toBe('image/png')
    expect(imageOutputMimeType('jpeg')).toBe('image/jpeg')
    expect(imageOutputFileExtension('png')).toBe('png')
    expect(imageOutputFileExtension('jpeg')).toBe('jpg')
  })
})
