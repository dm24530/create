import { describe, expect, it, vi } from 'vitest'
import {
  fetchGatewayTaskContent,
  imageResultWithTaskTiming,
  workerResponseToSettledResult,
} from '../imageGatewayTaskContent'

describe('image gateway task content', () => {
  it('adds task timing to every returned image', () => {
    expect(imageResultWithTaskTiming(
      [{ url: 'https://cdn.example.com/result.png' }],
      2_000,
      1_000,
    )).toEqual([{
      url: 'https://cdn.example.com/result.png',
      __imageTaskCompletedAt: 2_000,
      __imageTaskDurationMs: 1_000,
    }])
  })

  it('fetches task content with the original API key', async () => {
    const content = new Blob(['image'])
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => content,
    }))
    const blob = await fetchGatewayTaskContent(
      'https://api.example.com/v1',
      'task/one',
      'sk-test',
      2,
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    expect(blob.size).toBe(5)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/images/tasks/task%2Fone/content?index=2',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-test' },
      }),
    )
  })

  it('converts worker success and failure responses into settled results', () => {
    expect(workerResponseToSettledResult({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify({ data: [{ url: 'https://cdn.example.com/result.png' }] }),
      startedAt: 1_000,
      completedAt: 2_000,
    })).toEqual({
      status: 'fulfilled',
      value: [{
        url: 'https://cdn.example.com/result.png',
        __imageTaskCompletedAt: 2_000,
        __imageTaskDurationMs: 1_000,
      }],
    })

    expect(workerResponseToSettledResult({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      body: JSON.stringify({ error: { message: 'temporary failure' } }),
    })).toEqual({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'temporary failure' }),
    })
  })
})
