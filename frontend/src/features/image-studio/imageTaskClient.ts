import { imageTaskNextPollDelay, imageTaskRetryDelay } from './imagePolling'
import {
  gatewayTaskPayload,
  gatewayTaskState,
  resolveGatewayPollUrl,
} from './imageTaskTransport'
import { ImageGenerationWaitCancelled } from '@/utils/imageGenerationWorker'

export class ImageGatewayTaskError extends Error {
  readonly statusCode?: number

  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'ImageGatewayTaskError'
    this.statusCode = statusCode
  }
}

export class ImageRequestTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`请求超时（${formatRequestTimeout(timeoutMs)}），请稍后重试`)
    this.name = 'ImageRequestTimeout'
  }
}

export interface ImageTaskClientOptions {
  fetchImpl?: typeof fetch
}

export interface PollGatewayImageTaskOptions extends ImageTaskClientOptions {
  apiBaseUrl: string
  extractImages: (payload: any) => any[]
  isCancelled?: () => boolean
  onPreview?: (items: any[]) => void
  deadline?: number
  timeoutMs?: number
  timeoutMessage?: string
  now?: () => number
  wait?: (delay: number) => Promise<void>
}

export function gatewayAsyncSubmitUrl(
  apiBaseUrl: string,
  syncUrl: string,
  geminiModel: boolean,
): string {
  if (geminiModel) {
    return `${apiBaseUrl.replace(/\/+$/, '')}/images/generations/async`
  }
  return syncUrl.replace(/\/images\/(generations|edits)$/, '/images/$1/async')
}

export function gatewayIdempotencyLookupUrl(apiBaseUrl: string, idempotencyKey: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/images/tasks/by-idempotency/${encodeURIComponent(idempotencyKey)}`
}

export function gatewayTaskError(payload: any, httpStatus?: number): Error {
  const message = payload?.error?.message
    || payload?.error
    || payload?.message
    || '图片生成任务失败'
  const status = Number(payload?.http_status || httpStatus || 0)
  return new ImageGatewayTaskError(
    status > 0 ? `上游 API 错误 (HTTP ${status})：${message}` : String(message),
    status > 0 ? status : undefined,
  )
}

export function formatRequestTimeout(timeoutMs: number): string {
  if (timeoutMs < 60_000) return `${Math.max(1, Math.ceil(timeoutMs / 1_000))} 秒`
  return `${Math.ceil(timeoutMs / 60_000)} 分钟`
}

export function isTransientGatewayError(error: unknown): boolean {
  if (error instanceof ImageRequestTimeout) return true
  const message = error instanceof Error ? error.message : String(error || '')
  return /failed to fetch|network error|networkerror|load failed|fetch failed|econnreset|etimedout|temporarily unavailable/i.test(message)
}

export function isTransientGatewayStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
}

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs = 30_000,
  options: ImageTaskClientOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) throw new ImageRequestTimeout(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function lookupGatewayTaskByIdempotency(
  apiBaseUrl: string,
  idempotencyKey: string,
  headers: Record<string, string>,
  options: ImageTaskClientOptions = {},
) {
  const response = await fetchWithTimeout(
    gatewayIdempotencyLookupUrl(apiBaseUrl, idempotencyKey),
    { headers },
    15_000,
    options,
  )
  if (response.status === 404) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw gatewayTaskError(payload, response.status)
  return gatewayTaskPayload(payload)
}

export async function pollGatewayImageTask(
  pollUrl: string,
  headers: Record<string, string>,
  options: PollGatewayImageTaskOptions,
): Promise<any[]> {
  const now = options.now || Date.now
  const wait = options.wait || ((delay: number) => (
    new Promise<void>((resolve) => setTimeout(resolve, delay))
  ))
  const timeoutMs = options.timeoutMs || 10 * 60 * 1000
  const timeoutMessage = options.timeoutMessage || '图片生成超时，已停止等待'
  const deadline = Math.min(
    now() + timeoutMs,
    Number(options.deadline || 0) || Number.POSITIVE_INFINITY,
  )
  const pollStartedAt = now()
  const fallbackOrigin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'http://localhost'
  const url = resolveGatewayPollUrl(pollUrl, options.apiBaseUrl, fallbackOrigin)
  let previewDelivered = false

  while (now() < deadline) {
    if (options.isCancelled?.()) throw new ImageGenerationWaitCancelled()
    let response: Response
    let payload: any
    try {
      response = await fetchWithTimeout(
        url,
        { headers },
        Math.min(30_000, Math.max(1, deadline - now())),
        { fetchImpl: options.fetchImpl },
      )
      payload = await response.json().catch(() => null)
    } catch (error) {
      if (error instanceof ImageGenerationWaitCancelled) throw error
      if (isTransientGatewayError(error)) {
        if (now() < deadline) {
          await wait(imageTaskRetryDelay(now() - pollStartedAt))
          continue
        }
        throw new Error(timeoutMessage)
      }
      throw error instanceof Error ? error : new Error('查询图片任务失败')
    }

    if (isTransientGatewayStatus(response.status)) {
      if (now() < deadline) {
        await wait(imageTaskRetryDelay(now() - pollStartedAt))
        continue
      }
      throw new Error(timeoutMessage)
    }
    if (!response.ok) throw gatewayTaskError(payload, response.status)

    const task = gatewayTaskPayload(payload)
    const state = gatewayTaskState(task)
    if (state === 'completed') {
      const result = task.result
      const normalized = typeof result === 'string' ? JSON.parse(result) : result
      return options.extractImages(normalized)
    }
    if (state === 'preview_ready' && !previewDelivered) {
      const result = task.result
      const normalized = typeof result === 'string' ? JSON.parse(result) : result
      const previewItems = options.extractImages(normalized)
      if (previewItems.length) {
        previewDelivered = true
        options.onPreview?.(previewItems)
      }
    }
    if (state === 'failed') {
      throw gatewayTaskError(task.error || task, Number(task?.http_status || 0))
    }
    await wait(imageTaskNextPollDelay(now() - pollStartedAt, previewDelivered))
  }

  throw new Error(timeoutMessage)
}
