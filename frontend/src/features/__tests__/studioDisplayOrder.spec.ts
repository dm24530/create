import { describe, expect, it } from 'vitest'

import { normalizeStudioDisplayOrder } from '../studioDisplayOrder'

describe('normalizeStudioDisplayOrder', () => {
  it('normalizes legacy seconds and milliseconds to microseconds', () => {
    const seconds = 1_700_000_000
    const milliseconds = seconds * 1000
    const microseconds = milliseconds * 1000

    expect(normalizeStudioDisplayOrder(seconds)).toBe(microseconds)
    expect(normalizeStudioDisplayOrder(milliseconds)).toBe(microseconds)
    expect(normalizeStudioDisplayOrder(microseconds)).toBe(microseconds)
  })

  it('ignores missing or invalid values', () => {
    expect(normalizeStudioDisplayOrder(undefined)).toBe(0)
    expect(normalizeStudioDisplayOrder('')).toBe(0)
    expect(normalizeStudioDisplayOrder(-1)).toBe(0)
  })
})
