import { describe, expect, it } from 'vitest'

import { imageTaskNextPollDelay, imageTaskPollInterval, imageTaskRetryDelay } from '../imagePolling'

describe('imageTaskPollInterval', () => {
  it('uses the steady interval during the initial generation window', () => {
    expect(imageTaskPollInterval(0)).toBe(750)
    expect(imageTaskPollInterval(4_999)).toBe(750)
  })

  it('keeps polling at the steady interval as generation continues', () => {
    expect(imageTaskPollInterval(5_000)).toBe(750)
    expect(imageTaskPollInterval(15_000)).toBe(750)
    expect(imageTaskPollInterval(30_000)).toBe(750)
    expect(imageTaskPollInterval(60_000)).toBe(750)
  })

  it('treats invalid elapsed values as the steady interval', () => {
    expect(imageTaskPollInterval(Number.NaN)).toBe(750)
    expect(imageTaskPollInterval(-1)).toBe(750)
  })
})

describe('imageTaskRetryDelay', () => {
  it('retries transient failures promptly without creating a tight loop', () => {
    expect(imageTaskRetryDelay(0)).toBe(1_000)
    expect(imageTaskRetryDelay(20_000)).toBe(1_000)
    expect(imageTaskRetryDelay(60_000)).toBe(1_000)
  })
})

describe('imageTaskNextPollDelay', () => {
  it('uses the fast finalize interval after a preview is visible', () => {
    expect(imageTaskNextPollDelay(0, true)).toBe(750)
    expect(imageTaskNextPollDelay(60_000, true)).toBe(750)
    expect(imageTaskNextPollDelay(0, false)).toBe(750)
  })
})
