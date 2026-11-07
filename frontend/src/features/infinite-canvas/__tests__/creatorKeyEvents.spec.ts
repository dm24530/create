import { describe, expect, it, vi } from 'vitest'

import {
  notifyCreatorKeyChanged,
  onCreatorKeyChanged,
} from '@/utils/creatorKeyEvents'

describe('creator key events', () => {
  it('notifies the mounted canvas that the studio key changed', () => {
    const listener = vi.fn()
    const unsubscribe = onCreatorKeyChanged(listener)

    notifyCreatorKeyChanged('image', '42')

    expect(listener).toHaveBeenCalledWith({ kind: 'image', keyId: '42' })
    unsubscribe()

    notifyCreatorKeyChanged('image', '43')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
