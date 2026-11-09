import { gatewayTaskPayload } from './imageTaskTransport'

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
