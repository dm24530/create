import { describe, expect, it } from 'vitest'
import {
  IMAGE_CONSTRAINTS,
  fitImageSizeToWindow,
  normalizeImageDimension,
  parseImageSizeValue,
  validateImageSize,
} from '../imageSizeConstraints'

describe('image size constraints', () => {
  it('converges an oversized square into the upstream pixel window', () => {
    expect(fitImageSizeToWindow(3840, 3840)).toEqual({
      width: 2880,
      height: 2880,
    })
  })

  it('validates the converged square', () => {
    expect(validateImageSize('2880x2880')).toBe('')
  })

  it('rejects a square above the maximum pixel count', () => {
    expect(validateImageSize('3840x3840')).toContain('超过上限')
  })

  it('normalizes dimensions to the 16-pixel grid and configured maximum', () => {
    expect(normalizeImageDimension(100, 4096)).toBe(256)
    expect(normalizeImageDimension(4097, 4096)).toBe(4096)
  })

  it('rejects non-multiple dimensions and extreme ratios', () => {
    expect(validateImageSize('1000x1000')).toBe('边长必须是 16 的倍数')
    expect(validateImageSize('1024x256')).toBe('长短边比不能超过 3:1')
  })

  it('parses supported dimensions', () => {
    expect(parseImageSizeValue('1024x768')).toEqual({
      width: 1024,
      height: 768,
    })
    expect(parseImageSizeValue('auto')).toBeNull()
    expect(IMAGE_CONSTRAINTS.maxEdge).toBe(3840)
  })
})
