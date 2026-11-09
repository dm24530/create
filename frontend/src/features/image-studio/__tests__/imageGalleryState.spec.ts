import { describe, expect, it } from 'vitest'
import {
  sameImageIdentityOrder,
  sameStoredObject,
  stableDisplayOrder,
} from '../imageGalleryState'

describe('image gallery state', () => {
  it('treats rotated signed URLs as the same stored object', () => {
    expect(sameStoredObject(
      'https://cdn.example.com/images/one.png?signature=old',
      'https://cdn.example.com/images/one.png?signature=new',
      'https://app.example.com',
    )).toBe(true)
  })

  it('treats a different object path as a different image', () => {
    expect(sameStoredObject(
      'https://cdn.example.com/images/one.png?signature=old',
      'https://cdn.example.com/images/two.png?signature=new',
      'https://app.example.com',
    )).toBe(false)
  })

  it('compares relative and absolute URLs by object identity', () => {
    expect(sameStoredObject(
      '/api/assets/one.png?signature=old',
      'https://app.example.com/api/assets/one.png?signature=new',
      'https://app.example.com',
    )).toBe(true)
  })

  it('keeps the slot assigned when the task was submitted', () => {
    expect(stableDisplayOrder(1_900_000_000, 1_800_000_000)).toBe(1_900_000_000)
    expect(stableDisplayOrder(undefined, 1_800_000_000)).toBe(1_800_000_000)
    expect(stableDisplayOrder(0, 1_800_000_000)).toBe(1_800_000_000)
  })

  it('detects identity order changes without relying on object identity', () => {
    expect(sameImageIdentityOrder(
      [{ id: 1 }, { id: 2 }],
      [{ id: '1' }, { id: '2' }],
    )).toBe(true)
    expect(sameImageIdentityOrder(
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 1 }],
    )).toBe(false)
  })
})
