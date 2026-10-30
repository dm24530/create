import { describe, expect, it } from 'vitest'

import { resolveGeminiImageModelPolicy } from '../geminiImageModelPolicy'

describe('geminiImageModelPolicy', () => {
  it('keeps Nano Banana at the 14-image capability confirmed in production', () => {
    expect(resolveGeminiImageModelPolicy('gemini-nano-banana-2.1')).toEqual({
      maxReferences: 14,
      allowedQualities: ['auto', 'high', 'medium', 'low'],
      notice: '',
    })
  })

  it('limits the 2.5 Flash image model to three references', () => {
    const policy = resolveGeminiImageModelPolicy('gemini-2.5-flash-image')

    expect(policy.maxReferences).toBe(3)
    expect(policy.notice).toContain('最多 3 张')
  })

  it('keeps Pro image models at 14 references', () => {
    expect(resolveGeminiImageModelPolicy('gemini-3-pro-image').maxReferences).toBe(14)
    expect(resolveGeminiImageModelPolicy('gemini-3-pro-image-preview').maxReferences).toBe(14)
  })

  it('restricts Flash Lite to automatic or 1K output', () => {
    const policy = resolveGeminiImageModelPolicy('gemini-3.1-flash-lite-image')

    expect(policy.maxReferences).toBe(14)
    expect(policy.allowedQualities).toEqual(['auto', 'low'])
    expect(policy.notice).toContain('1K')
  })
})
