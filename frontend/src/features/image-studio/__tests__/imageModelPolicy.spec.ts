import { describe, expect, it } from 'vitest'
import {
  deduplicateImageModelNames,
  isGeminiImageModelName,
  isGrokImageModelName,
  isImageModelName,
  prefersURLImageResponse,
} from '../imageModelPolicy'

describe('image model policy', () => {
  it('recognizes supported image model families', () => {
    expect(isImageModelName('gpt-image-1')).toBe(true)
    expect(isImageModelName('gemini-2.5-flash-image')).toBe(true)
    expect(isImageModelName('grok-imagine-image')).toBe(true)
    expect(isImageModelName('text-embedding-3-large')).toBe(false)
  })

  it('distinguishes Grok image models from Grok video models', () => {
    expect(isGrokImageModelName('grok-imagine-image')).toBe(true)
    expect(isGrokImageModelName('grok-imagine-video')).toBe(false)
  })

  it('prefers URL responses for GPT image families', () => {
    expect(prefersURLImageResponse('gpt-image-2-5-sunburst')).toBe(true)
    expect(prefersURLImageResponse('GPT-IMAGE-2-6')).toBe(true)
    expect(prefersURLImageResponse('dall-e-3')).toBe(true)
    expect(prefersURLImageResponse('grok-imagine-image')).toBe(false)
    expect(prefersURLImageResponse('flux-pro')).toBe(false)
  })

  it('recognizes Gemini-compatible image models', () => {
    expect(isGeminiImageModelName('gemini-2.5-flash-image')).toBe(true)
    expect(isGeminiImageModelName('nano-banana-pro')).toBe(true)
    expect(isGeminiImageModelName('gemini-2.5-pro')).toBe(false)
  })

  it('deduplicates models case-insensitively and sorts naturally', () => {
    expect(deduplicateImageModelNames([
      ' gpt-image-2 ',
      'GPT-IMAGE-2',
      'gpt-image-1',
      '',
      'gemini-image',
    ])).toEqual([
      'gemini-image',
      'gpt-image-1',
      'gpt-image-2',
    ])
  })
})
