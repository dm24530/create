import type { GeneratedImage } from './imageStudioTypes'

export function normalizeImageRequestCount(value: unknown): number {
  return Math.min(Math.max(Number(value) || 1, 1), 4)
}

export function allocateImageBatchDisplayOrder(
  currentCursor: number,
  now: number,
  count: number,
) {
  const batchSize = Math.max(1, count)
  const order = Math.max(now * 1000, currentCursor + batchSize + 1)
  return {
    order,
    nextCursor: order,
  }
}

interface CreatePendingImageBatchOptions {
  count: number
  nextImageId: number
  createTaskId: () => string
  batchId: string
  apiKeyId: number
  startedAt: number
  displayOrderBase: number
  prompt: string
  model: string
  size: string
  quality: string
  format: string
  background: string
  customSizeRequested: boolean
  hadReferences: boolean
}

export function createPendingImageBatch(options: CreatePendingImageBatchOptions) {
  const count = normalizeImageRequestCount(options.count)
  let nextId = options.nextImageId
  const images = Array.from({ length: count }, (_, index): GeneratedImage => ({
    id: nextId++,
    title: `正在生成 ${index + 1}`,
    src: '',
    meta: `${options.format.toUpperCase()} · ${options.size} · ${options.model}`,
    pending: true,
    taskId: options.createTaskId(),
    batchId: options.batchId,
    apiKeyId: options.apiKeyId,
    startedAt: options.startedAt,
    displayOrder: options.displayOrderBase - index,
    prompt: options.prompt,
    model: options.model,
    size: options.size,
    format: options.format,
    quality: options.quality,
    background: options.background,
    customSizeRequested: options.customSizeRequested,
    hadReferences: options.hadReferences,
  }))
  return {
    images,
    nextImageId: nextId,
  }
}

export function failImageTask(
  image: GeneratedImage,
  message: string,
  now = Date.now(),
) {
  image.pending = false
  image.failed = true
  image.error = message
  image.title = '生成失败'
  image.src = ''
  image.originalSrc = undefined
  image.thumbSrc = undefined
  image.thumbSrcSet = undefined
  image.previewSrc = undefined
  image.saved = false
  image.expiresAt = 0
  image.createdAt = image.createdAt || Math.floor(now / 1000)
  image.durationMs = image.startedAt
    ? Math.max(1, now - Number(image.startedAt))
    : image.durationMs
}

export function removePendingTaskImages(
  images: GeneratedImage[],
  pendingImages: GeneratedImage[],
  retainedIds: ReadonlySet<GeneratedImage['id']>,
) {
  const pendingIds = new Set(
    pendingImages
      .filter((image) => image.pending && !retainedIds.has(image.id))
      .map((image) => image.id),
  )
  return images.filter((image) => !pendingIds.has(image.id))
}
