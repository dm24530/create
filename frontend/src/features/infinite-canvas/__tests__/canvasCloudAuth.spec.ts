import { describe, expect, it, vi } from 'vitest'

import {
  configureCanvasAuth,
  subscribeCanvasAuth,
} from '../../../../../canvas-app/src/services/canvas-auth'

describe('canvas cloud auth notifications', () => {
  it('does not republish an unchanged access token', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasAuth(listener)

    configureCanvasAuth('token-a')
    configureCanvasAuth(' token-a ')

    expect(listener).toHaveBeenCalledTimes(1)

    configureCanvasAuth('token-b')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })
})
