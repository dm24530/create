import type { Ref } from 'vue'
import type { GeneratedImage } from './imageStudioTypes'
import type { GenerationResultHandler } from './imageGenerationProgress'
import type { GenerationOwnerSnapshot } from './imageGenerationProgress'
import {
  fetchWithTimeout,
  gatewayTaskError,
} from './imageTaskClient'
import {
  imageResultWithTaskTiming,
  workerResponseToSettledResult,
} from './imageGatewayTaskContent'
import { extractImages } from './imageRequestBuilder'
import {
  IMAGE_CONSTRAINTS,
} from './imageSizeConstraints'

interface GenerationFinalizeOptions {
  images: Ref<GeneratedImage[]>
  prompt: Ref<string>
  imageModel: Ref<string>
  format: Ref<string>
  size: Ref<string>
  quality: Ref<string>
  background: Ref<string>
  gifFormat: string
  errorMessage: Ref<string>
  timeoutMs: number
  isDisposed: () => boolean
  isOwnerCurrent: (owner: GenerationOwnerSnapshot) => boolean
  formatError: (error: unknown, fallback: string) => string
  resolveImageAssetURL: (url: string) => string
  imageNeedsLocalResize: (size: string, maxEdge: number) => boolean
  imageFormatFromResult: (item: any, src: string, fallback: string) => string
  imageMIMETypeForFormat: (format: unknown) => string
  allocateNextId: () => number
  persistPending: () => void
  reportError: (message: string) => void
  showWarning: (message: string, timeout?: number) => void
  queueImageDisplayProcessing: (
    image: GeneratedImage,
    source: string,
    targetSize: string,
    targetFormat: string,
    owner: GenerationOwnerSnapshot | undefined,
    onError: (error: string) => void,
  ) => Promise<void>
  persistGeneratedImages: (
    generated: GeneratedImage[],
    prompt: string,
    model: string,
    options: { owner?: GenerationOwnerSnapshot },
  ) => Promise<boolean>
  tryExecuteGatewayAsyncRequests: (
    pendingImages: GeneratedImage[],
    url: string,
    headers: Record<string, string>,
    body: string | FormData,
    geminiModel: boolean,
    onResult?: GenerationResultHandler,
  ) => Promise<PromiseSettledResult<any[]>[] | null>
  tryStartPersistentImageGeneration: (requests: any[]) => Promise<boolean>
  waitForPersistentImageGeneration: (
    ids: string[],
    options: {
      isCancelled: () => boolean
      onResponse: (id: string, response: any) => Promise<void>
    },
  ) => Promise<any[]>
}

export function createImageGenerationFinalizer(options: GenerationFinalizeOptions) {
  async function executeGenerationRequests(
    pendingImages: GeneratedImage[],
    url: string,
    headers: Record<string, string>,
    body: string | FormData,
    geminiModel: boolean,
    onResult?: GenerationResultHandler,
  ): Promise<PromiseSettledResult<any[]>[]> {
    const gatewayResults = await options.tryExecuteGatewayAsyncRequests(
      pendingImages,
      url,
      headers,
      body,
      geminiModel,
      onResult,
    )
    if (gatewayResults) return gatewayResults

    const taskRequests = pendingImages
      .filter((image): image is GeneratedImage & { taskId: string } => Boolean(image.taskId))
      .map((image) => ({
        id: image.taskId,
        url,
        init: {
          method: 'POST' as const,
          headers,
          body,
        },
        createdAt: image.startedAt || Date.now(),
      }))

    if (taskRequests.length === pendingImages.length) {
      const started = await options.tryStartPersistentImageGeneration(taskRequests)
      if (started) {
        const imagesByTaskId = new Map(
          pendingImages.map((image) => [String(image.taskId), image]),
        )
        const responses = await options.waitForPersistentImageGeneration(
          taskRequests.map((request) => request.id),
          {
            isCancelled: () => options.isDisposed(),
            onResponse: async (id, response) => {
              const image = imagesByTaskId.get(id)
              if (!image) return
              await onResult?.(image, workerResponseToSettledResult(response))
            },
          },
        )
        return responses.map(workerResponseToSettledResult)
      }
    }

    return Promise.allSettled(pendingImages.map(async (image) => {
      const response = await fetchWithTimeout(
        url,
        { method: 'POST', headers, body },
        options.timeoutMs,
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw gatewayTaskError(payload, response.status)
      }
      const result = {
        status: 'fulfilled' as const,
        value: imageResultWithTaskTiming(extractImages(payload), Date.now(), image.startedAt),
      }
      await onResult?.(image, result)
      return result.value
    }))
  }

  async function finishGenerationBatch(
    pendingImages: GeneratedImage[],
    results: PromiseSettledResult<any[]>[],
    titleStart = 1,
    persist = true,
    owner?: GenerationOwnerSnapshot,
  ) {
    if (owner && !options.isOwnerCurrent(owner)) return []
    const items: any[] = []
    let firstError: unknown = null
    for (const result of results) {
      if (result.status === 'fulfilled') {
        items.push(...result.value)
      } else if (!firstError) {
        firstError = result.reason
      }
    }
    if (!items.length) {
      throw firstError || new Error('上游没有返回图片')
    }
    if (firstError) {
      options.errorMessage.value = options.formatError(firstError, '部分图片生成失败')
    }

    const firstPending = pendingImages[0]
    const currentPrompt = firstPending?.prompt || options.prompt.value.trim()
    const currentModel = firstPending?.model || options.imageModel.value
    const requestedFormat = firstPending?.format || options.format.value
    const requestedSize = firstPending?.size || options.size.value
    const completedAtMs = Date.now()
    const visibleDurationMs = Number(firstPending?.durationMs || 0)
    const fallbackDurationMs = Number(firstPending?.startedAt || 0) > 0
      ? Math.max(1, completedAtMs - Number(firstPending.startedAt))
      : undefined
    const generated: GeneratedImage[] = []
    const resizeTargets: Array<{ image: GeneratedImage; source: string }> = []
    const needsLocalResize = Boolean(firstPending?.customSizeRequested)
      && options.imageNeedsLocalResize(requestedSize, IMAGE_CONSTRAINTS.maxEdge)
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const resultFormat = options.imageFormatFromResult(item, '', requestedFormat)
      const mime = String(
        item.mimeType || item.mime_type || options.imageMIMETypeForFormat(resultFormat),
      )
      const b64 = String(item.b64_json || item.data || '')
      const previewDataURL = String(item.preview_data_url || '')
      const remoteSrc = options.resolveImageAssetURL(
        String(item.display_url || item.url || ''),
      )
      const rawSrc = (b64
        ? `data:${mime};base64,${b64}`
        : remoteSrc) || previewDataURL
      if (!rawSrc) continue
      const previewSrc = String(item.preview_data_url || '')
      const actualFormat = options.imageFormatFromResult(item, rawSrc, requestedFormat)
      const itemCompletedAt = Number(item.__imageTaskCompletedAt || 0)
      const itemDurationMs = Number(item.__imageTaskDurationMs || 0)
      const generatedImage: GeneratedImage = {
        id: options.allocateNextId(),
        title: `生成结果 ${titleStart + index}`,
        src: rawSrc,
        originalSrc: rawSrc,
        thumbSrc: previewSrc || undefined,
        prompt: currentPrompt,
        model: currentModel,
        size: requestedSize,
        format: actualFormat,
        quality: firstPending?.quality || options.quality.value,
        background: firstPending?.background || options.background.value,
        customSizeRequested: firstPending?.customSizeRequested,
        meta: `${actualFormat.toUpperCase()} · ${requestedSize} · ${currentModel}`,
        createdAt: Math.floor((itemCompletedAt > 0 ? itemCompletedAt : completedAtMs) / 1000),
        durationMs: visibleDurationMs > 0
          ? visibleDurationMs
          : itemDurationMs > 0
            ? itemDurationMs
            : fallbackDurationMs,
        taskId: firstPending?.taskId,
        gatewayTaskId: firstPending?.gatewayTaskId,
        gatewayPollUrl: firstPending?.gatewayPollUrl,
        apiKeyId: firstPending?.apiKeyId,
        displayOrder: firstPending?.displayOrder,
        startedAt: firstPending?.startedAt,
      }
      generated.push(generatedImage)
      if (needsLocalResize && actualFormat !== options.gifFormat) {
        resizeTargets.push({ image: generatedImage, source: rawSrc })
      }
    }

    const pendingIds = new Set(pendingImages.map((item) => item.id))
    if (owner && !options.isOwnerCurrent(owner)) return []
    const pendingIndex = options.images.value.findIndex((item) => pendingIds.has(item.id))
    options.images.value = options.images.value.filter((item) => !pendingIds.has(item.id))
    if (pendingIndex >= 0) {
      options.images.value.splice(
        Math.min(pendingIndex, options.images.value.length),
        0,
        ...generated,
      )
    }
    options.persistPending()

    let localProcessError = ''
    const reportLocalProcessError = (error: string) => {
      if (localProcessError) return
      localProcessError = error
      const message = '本地尺寸处理失败，已保留并显示上游原图。'
      options.reportError(message)
      options.showWarning(message, 6000)
    }
    const processingTasks = resizeTargets.map((target) => {
      return options.queueImageDisplayProcessing(
        target.image,
        target.source,
        requestedSize,
        requestedFormat,
        owner,
        reportLocalProcessError,
      )
    })

    if (persist) {
      await Promise.all(processingTasks)
      await options.persistGeneratedImages(generated, currentPrompt, currentModel, { owner })
    }
    return generated
  }

  return {
    executeGenerationRequests,
    finishGenerationBatch,
  }
}
