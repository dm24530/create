import type { ImageGenerationWorkerResponse } from '@/utils/imageGenerationWorker'
import { extractImages } from './imageRequestBuilder'
import {
  fetchWithTimeout,
  type ImageTaskClientOptions,
} from './imageTaskClient'

export function imageResultWithTaskTiming(
  items: any[],
  completedAt: number,
  startedAt?: number,
) {
  const durationMs = Number(startedAt || 0) > 0
    ? Math.max(1, completedAt - Number(startedAt))
    : undefined
  return items.map((item) => ({
    ...(item && typeof item === 'object' ? item : { result: item }),
    __imageTaskCompletedAt: completedAt,
    __imageTaskDurationMs: durationMs,
  }))
}

export async function fetchGatewayTaskContent(
  apiBaseUrl: string,
  taskId: string,
  apiKey: string,
  imageIndex: number,
  options: ImageTaskClientOptions = {},
) {
  const url = `${apiBaseUrl.replace(/\/+$/, '')}/images/tasks/${encodeURIComponent(taskId)}/content?index=${imageIndex}`
  const response = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    2 * 60 * 1000,
    options,
  )
  if (!response.ok) {
    throw new Error(`读取原图失败（${response.status}）`)
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('本地原图为空')
  return blob
}

export function workerResponseToSettledResult(
  response: ImageGenerationWorkerResponse,
): PromiseSettledResult<any[]> {
  let payload: any = null
  try {
    payload = response.body ? JSON.parse(response.body) : null
  } catch {
    // Non-JSON upstream errors are handled below.
  }
  if (!response.ok) {
    return {
      status: 'rejected',
      reason: new Error(
        payload?.error?.message
        || payload?.message
        || payload?.error
        || response.body
        || `${response.status} ${response.statusText}`,
      ),
    }
  }
  try {
    return {
      status: 'fulfilled',
      value: imageResultWithTaskTiming(
        extractImages(payload),
        Number(response.completedAt || 0),
        Number(response.startedAt || 0),
      ),
    }
  } catch (error) {
    return { status: 'rejected', reason: error }
  }
}
