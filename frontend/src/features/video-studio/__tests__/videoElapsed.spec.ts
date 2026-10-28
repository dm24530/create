import { describe, expect, it } from 'vitest'

import { formatVideoElapsedSeconds } from '../videoElapsed'

describe('formatVideoElapsedSeconds', () => {
  it('shows seconds below one minute', () => {
    expect(formatVideoElapsedSeconds(0)).toBe('0 秒')
    expect(formatVideoElapsedSeconds(59)).toBe('59 秒')
  })

  it('switches to minutes at sixty seconds', () => {
    expect(formatVideoElapsedSeconds(60)).toBe('1 分 00 秒')
    expect(formatVideoElapsedSeconds(125)).toBe('2 分 05 秒')
  })

  it('clamps invalid and negative values to zero', () => {
    expect(formatVideoElapsedSeconds(-1)).toBe('0 秒')
    expect(formatVideoElapsedSeconds(Number.NaN)).toBe('0 秒')
  })
})
