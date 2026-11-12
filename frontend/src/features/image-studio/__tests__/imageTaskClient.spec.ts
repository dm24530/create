import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ImageGatewayTaskError,
  ImageRequestTimeout,
  fetchWithTimeout,
  gatewayAsyncSubmitUrl,
  gatewayIdempotencyLookupUrl,
  gatewayTaskError,
  isTransientGatewayStatus,
  lookupGatewayTaskByIdempotency,
  pollGatewayImageTask,
} from '../imageTaskClient'

describe('image task client', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('maps generation and edit URLs to their async endpoints', () => {
    expect(gatewayAsyncSubmitUrl(
      'https://api.example.com/v1',
      'https://api.example.com/v1/images/generations',
      false,
    )).toBe('https://api.example.com/v1/images/generations/async')
    expect(gatewayAsyncSubmitUrl(
      'https://api.example.com/v1',
      'https://api.example.com/v1/images/edits',
      false,
    )).toBe('https://api.example.com/v1/images/edits/async')
  })

  it('uses the dedicated Gemini async endpoint', () => {
    expect(gatewayAsyncSubmitUrl(
      'https://api.example.com/v1/',
      'https://ignored.example.com/images/generations',
      true,
    )).toBe('https://api.example.com/v1/images/generations/async')
  })

  it('builds an idempotency lookup URL', () => {
    expect(gatewayIdempotencyLookupUrl(
      'https://api.example.com/v1/',
      'task/one',
    )).toBe(
      'https://api.example.com/v1/images/tasks/by-idempotency/task%2Fone',
    )
  })

  it('formats gateway failures with the upstream HTTP status', () => {
    const error = gatewayTaskError({
      error: { message: 'upstream unavailable' },
      http_status: 503,
    })

    expect(error).toBeInstanceOf(ImageGatewayTaskError)
    expect(error.message).toContain('HTTP 503')
    expect((error as ImageGatewayTaskError).statusCode).toBe(503)
  })

  it('recognizes only transient HTTP statuses', () => {
    expect(isTransientGatewayStatus(408)).toBe(true)
    expect(isTransientGatewayStatus(429)).toBe(true)
    expect(isTransientGatewayStatus(503)).toBe(true)
    expect(isTransientGatewayStatus(400)).toBe(false)
    expect(isTransientGatewayStatus(404)).toBe(false)
  })

  it('aborts a request that exceeds its timeout', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    )) as unknown as typeof fetch

    const request = fetchWithTimeout('/slow', {}, 25, { fetchImpl })
    const expectation = expect(request).rejects.toBeInstanceOf(ImageRequestTimeout)
    await vi.advanceTimersByTimeAsync(25)

    await expectation
  })

  it('returns null when an idempotency lookup is not found', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    await expect(lookupGatewayTaskByIdempotency(
      'https://api.example.com/v1',
      'task-1',
      { Authorization: 'Bearer test' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )).resolves.toBeNull()
  })

  it('unwraps a recovered task response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: {
        task_id: 'task-1',
        status: 'processing',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(lookupGatewayTaskByIdempotency(
      'https://api.example.com/v1',
      'task-1',
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )).resolves.toEqual({
      task_id: 'task-1',
      status: 'processing',
    })
  })

  it('delivers a preview once and then returns the completed result', async () => {
    const preview = vi.fn()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: 'task-1',
        status: 'preview_ready',
        result: { data: [{ preview_url: 'https://cdn.example.com/preview.png' }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: 'task-1',
        status: 'completed',
        result: { data: [{ url: 'https://cdn.example.com/original.png' }] },
      }), { status: 200 }))

    const items = await pollGatewayImageTask(
      '/images/tasks/task-1',
      { Authorization: 'Bearer test' },
      {
        apiBaseUrl: 'https://api.example.com/v1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        extractImages: (payload) => payload?.data || [],
        onPreview: preview,
        wait: async () => undefined,
        now: () => 1_000,
      },
    )

    expect(preview).toHaveBeenCalledTimes(1)
    expect(items).toEqual([{ url: 'https://cdn.example.com/original.png' }])
  })

  it('keeps polling at the fast interval after the preview has been delivered', async () => {
    let now = 1_000
    const waits: number[] = []
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: 'task-1',
        status: 'preview_ready',
        result: { data: [{ preview_url: 'https://cdn.example.com/preview.png' }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: 'task-1',
        status: 'completed',
        result: { data: [{ url: 'https://cdn.example.com/original.png' }] },
      }), { status: 200 }))

    await pollGatewayImageTask(
      '/images/tasks/task-1',
      {},
      {
        apiBaseUrl: 'https://api.example.com/v1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        extractImages: (payload) => payload?.data || [],
        onPreview: () => undefined,
        now: () => now,
        wait: async (delay) => {
          waits.push(delay)
          now += delay
        },
      },
    )

    expect(waits).toEqual([250])
  })

  it('retries a transient poll without surfacing an error', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: 'task-1',
        status: 'completed',
        result: { data: [{ url: 'https://cdn.example.com/original.png' }] },
      }), { status: 200 }))

    await expect(pollGatewayImageTask(
      '/images/tasks/task-1',
      {},
      {
        apiBaseUrl: 'https://api.example.com/v1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        extractImages: (payload) => payload?.data || [],
        wait: async () => undefined,
        now: () => 1_000,
      },
    )).resolves.toEqual([
      { url: 'https://cdn.example.com/original.png' },
    ])
  })
})
