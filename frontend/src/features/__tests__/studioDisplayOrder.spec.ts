import { describe, expect, it } from 'vitest'

import {
  normalizeStudioDisplayOrder,
  sortStudioItemsByDisplayOrder,
} from '../studioDisplayOrder'

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

  it('keeps a saved legacy item below newer unsaved images', () => {
    const items = [
      { id: 'saved-old', saved: true, displayOrder: 1_700_000_000_000 },
      { id: 'newer', saved: false, displayOrder: 1_800_000_000_000_000 },
      { id: 'newest', saved: false, displayOrder: 1_900_000_000_000_000 },
    ]

    expect(sortStudioItemsByDisplayOrder(items).map((item) => item.id)).toEqual([
      'newest',
      'newer',
      'saved-old',
    ])
  })

  it('preserves the existing relative order for identical slots', () => {
    const items = [
      { id: 'first', displayOrder: 2_000_000_000_000_000 },
      { id: 'second', displayOrder: 2_000_000_000_000_000 },
    ]

    expect(sortStudioItemsByDisplayOrder(items).map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
  })
})
