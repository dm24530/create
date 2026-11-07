import { describe, expect, it } from 'vitest'

import { shouldSkipClientImageNormalization } from '../../../../../canvas-app/src/lib/image-normalization-policy'

describe('canvas image normalization', () => {
  it('skips normalization when a displayable preview is available', () => {
    expect(shouldSkipClientImageNormalization({
      dataUrl: 'https://cdn.example.test/full.png',
      previewDataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
    })).toBe(true)
  })

  it('does not transcode a remote original before rendering', () => {
    expect(shouldSkipClientImageNormalization({
      dataUrl: 'https://cdn.example.test/full.jpg',
    })).toBe(true)
  })

  it('keeps local data URLs eligible for format normalization', () => {
    expect(shouldSkipClientImageNormalization({
      dataUrl: 'data:image/png;base64,cG5n',
    })).toBe(false)
  })
})
