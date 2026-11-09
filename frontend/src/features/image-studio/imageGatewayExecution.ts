import type { GeneratedImage } from './imageStudioTypes'
import type { GenerationResultHandler } from './imageGenerationProgress'
import {
  fetchWithTimeout,
  gatewayAsyncSubmitUrl,
  gatewayTaskError,
  isTransientGatewayError,
  isTransientGatewayStatus,
  lookupGatewayTaskByIdempotency,
} from './imageTaskClient'
import {
  gatewayPollUrlForTask,
  gatewayTaskPayload,
} from './imageTaskTransport'
import { imageResultWithTaskTiming } from './imageGatewayTaskContent'
import { ImageSubmissionUnconfirmed } from './imageSubmissionErrors'

export function withIdempotencyHeader(
  headers: Record<string, string>,
  idempotencyKey: string,
) {
  return {
    ...headers,
    'Idempotency-Key': idempotencyKey,
  }
}

export function buildGatewayAsyncRequestBody(
  body: string | FormData,
  model: string,
  geminiModel: boolean,
) {
  if (!geminiModel) return body
  if (typeof body !== 'string') throw new Error('Gemini 图片请求格式无效')
  return JSON.stringify({
    model,
    request: JSON.parse(body),
  })
}

interface GatewayExecutionOptions {
  apiBaseUrl: string
  defaultModel: string
  imageCapableKeys: Array<{ id: number; key: string }>
  selectedKey: { key: string } | null
  timeoutMs: number
  asyncSubmitTimeoutMs: number
  timeoutMessage: string
  isDisposed: () => boolean
  persistPending: () => void
  waitRetry: (delay: number) => Promise<void>
  createTaskId: () => string
  pollTask: (
    pollUrl: string,
    headers: Record<string, string>,
    options: {
      isCancelled?: () => boolean
      onPreview?: (items: any[]) => void
      deadline?: number
    },
  ) => Promise<any[]>
  applyPreview: (image: GeneratedImage, items: any[]) => void
}

export async function executeGatewayAsyncRequests(
  pendingImages: GeneratedImage[],
  syncUrl: string,
  headers: Record<string, string>,
  body: string | FormData,
  geminiModel: boolean,
  onResult: GenerationResultHandler | undefined,
  options: GatewayExecutionOptions,
): Promise<PromiseSettledResult<any[]>[] | null> {
  const submitUrl = gatewayAsyncSubmitUrl(options.apiBaseUrl, syncUrl, geminiModel)
  const submitted: Array<{ image: GeneratedImage; pollUrl: string }> = []
  const results: Array<PromiseSettledResult<any[]> | null> = new Array(pendingImages.length).fill(null)
  let ambiguousSubmission = false

  for (const [imageIndex, image] of pendingImages.entries()) {
    const requestBody = buildGatewayAsyncRequestBody(
      body,
      image.model || options.defaultModel,
      geminiModel,
    )
    const idempotencyKey = image.taskId || options.createTaskId()
    image.taskId = idempotencyKey
    const requestHeaders = withIdempotencyHeader(headers, idempotencyKey)
    const generationDeadline = Number(image.startedAt || 0) > 0
      ? Number(image.startedAt) + options.timeoutMs
      : Date.now() + options.timeoutMs
    if (Date.now() >= generationDeadline) {
      const error = new Error(options.timeoutMessage)
      image.gatewaySubmitPending = false
      if (!submitted.length) throw error
      results[imageIndex] = { status: 'rejected', reason: error }
      options.persistPending()
      continue
    }
    image.gatewaySubmitPending = true
    options.persistPending()
    let response: Response | null = null
    let payload: any = null
    let requestError: unknown = null
    let transientSubmitFailure = false
    for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
      try {
        response = await fetchWithTimeout(
          submitUrl,
          {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
          },
          Math.min(
            options.asyncSubmitTimeoutMs,
            Math.max(1, generationDeadline - Date.now()),
          ),
        )
        payload = await response.json().catch(() => null)
      } catch (error) {
        requestError = error
      }
      if (response && isTransientGatewayStatus(response.status)) {
        requestError = gatewayTaskError(payload, response.status)
        response = null
      }
      if (!response && isTransientGatewayError(requestError)) {
        transientSubmitFailure = true
        ambiguousSubmission = true
        if (attempt === 2) break
        await options.waitRetry(500 * (attempt + 1))
        continue
      }
      break
    }
    if (!response && transientSubmitFailure) {
      try {
        const recovered = await lookupGatewayTaskByIdempotency(
          options.apiBaseUrl,
          idempotencyKey,
          headers,
        )
        if (recovered && gatewayPollUrlForTask(recovered, options.apiBaseUrl)) {
          response = {
            ok: true,
            json: async () => recovered,
          } as Response
          payload = recovered
          requestError = null
        }
      } catch {
        // Preserve the original submission error if recovery also fails.
      }
    }
    if (!response) {
      const reason = requestError instanceof Error
        ? requestError
        : new Error('提交图片任务失败')
      if (transientSubmitFailure) {
        results[imageIndex] = {
          status: 'rejected',
          reason: new ImageSubmissionUnconfirmed(),
        }
        continue
      }
      if (!submitted.length) throw reason
      results[imageIndex] = { status: 'rejected', reason }
      continue
    }
    if (response.status === 404) {
      if (!submitted.length && !ambiguousSubmission) {
        for (const pendingImage of pendingImages) {
          pendingImage.gatewaySubmitPending = false
        }
        options.persistPending()
        return null
      }
      results[imageIndex] = {
        status: 'rejected',
        reason: ambiguousSubmission
          ? new ImageSubmissionUnconfirmed()
          : gatewayTaskError(payload, response.status),
      }
      continue
    }
    if (!response.ok) {
      const error = gatewayTaskError(payload, response.status)
      if (!submitted.length) throw error
      results[imageIndex] = { status: 'rejected', reason: error }
      continue
    }
    const task = gatewayTaskPayload(payload)
    const taskPollUrl = gatewayPollUrlForTask(task, options.apiBaseUrl)
    if (!taskPollUrl) {
      const error = new Error('服务端没有返回图片任务地址')
      if (!submitted.length) throw error
      results[imageIndex] = { status: 'rejected', reason: error }
      continue
    }
    image.gatewayTaskId = String(task.task_id || task.id || '')
    image.gatewayPollUrl = taskPollUrl
    image.taskId = image.gatewayTaskId || image.taskId
    image.gatewaySubmitPending = false
    submitted.push({ image, pollUrl: taskPollUrl })
    options.persistPending()
  }

  const polled = await Promise.allSettled(
    submitted.map(async (task) => {
      const items = await options.pollTask(task.pollUrl, headers, {
        isCancelled: () => options.isDisposed(),
        onPreview: (previewItems) => options.applyPreview(task.image, previewItems),
        deadline: Number(task.image.startedAt || 0) > 0
          ? Number(task.image.startedAt) + options.timeoutMs
          : undefined,
      })
      const result = {
        status: 'fulfilled' as const,
        value: imageResultWithTaskTiming(items, Date.now(), task.image.startedAt),
      }
      await onResult?.(task.image, result)
      return result.value
    }),
  )
  pendingImages.forEach((image, index) => {
    const unconfirmed = results[index]?.status === 'rejected'
      && results[index].reason instanceof ImageSubmissionUnconfirmed
    if (!image.gatewayPollUrl && !unconfirmed) image.gatewaySubmitPending = false
  })
  options.persistPending()
  submitted.forEach((task, index) => {
    const imageIndex = pendingImages.indexOf(task.image)
    if (imageIndex >= 0) results[imageIndex] = polled[index]
  })
  return results.map((result) => result || {
    status: 'rejected',
    reason: new Error('图片任务没有返回结果'),
  })
}
