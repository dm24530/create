import { describe, expect, it } from 'vitest'

import { numericRequestTypeKind, requestTypeBadgeClass, requestTypeLabelKey } from '../errorBadges'

describe('request type badges', () => {
  it('maps async request type 6 to the async label and badge', () => {
    const kind = numericRequestTypeKind(6, false)

    expect(kind).toBe('async')
    expect(kind && requestTypeLabelKey(kind)).toBe('usage.async')
    expect(kind && requestTypeBadgeClass(kind)).toContain('cyan')
  })
})
