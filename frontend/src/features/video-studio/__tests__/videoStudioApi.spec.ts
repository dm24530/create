import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVideoTask, pollVideoTask } from '../videoStudioApi'

const context = { baseUrl: '/v1', apiKey: 'sk-test' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pollVideoTask network recovery', () => {
  it('retries transient network failures until the task can be read again', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'succeeded',
          content: { video_url: 'https://cdn.example.com/out.mp4' },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()

    const snapshot = await pollVideoTask(context, 'seedance', 'task-1', {
      intervalMs: 1,
      retryBaseMs: 1,
      timeoutMs: 1000,
      onRetry,
    })

    expect(snapshot.status).toBe('succeeded')
    expect(snapshot.videoUrl).toBe('https://cdn.example.com/out.mp4')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'invalid api key' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(pollVideoTask(context, 'seedance', 'task-1', {
      intervalMs: 1,
      retryBaseMs: 1,
      timeoutMs: 1000,
    })).rejects.toThrow('invalid api key')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('createVideoTask errors', () => {
  it('uses the already parsed upstream error instead of reading the body twice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { message: 'model is unavailable' } }),
    }))

    await expect(createVideoTask(context, {
      model: 'grok-video',
      prompt: 'a cat',
      durationSeconds: 6,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
      images: [],
      videos: [],
      audios: [],
    })).rejects.toThrow('model is unavailable')
  })
})
