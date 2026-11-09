export type ImageTaskPhase =
  | 'submitted'
  | 'generating'
  | 'preview_ready'
  | 'persisted'
  | 'failed'
  | 'uncertain'

export interface ImageTaskStateSource {
  id: number | string
  src?: string
  pending?: boolean
  failed?: boolean
  error?: string
  saved?: boolean
  taskId?: string
  gatewayTaskId?: string
  gatewayPollUrl?: string
  gatewaySubmitPending?: boolean
  previewSrc?: string
  galleryId?: string
}

export function resolveImageTaskPhase(image: ImageTaskStateSource): ImageTaskPhase {
  if (image.failed || image.error) return 'failed'

  if (image.pending) {
    if (image.gatewaySubmitPending) return 'uncertain'
    if (image.previewSrc) return 'preview_ready'
    return image.taskId || image.gatewayTaskId || image.gatewayPollUrl
      ? 'generating'
      : 'submitted'
  }

  if (image.saved) return 'persisted'
  if (image.src || image.previewSrc) return 'preview_ready'
  return 'uncertain'
}

export function isImageTaskActive(image: ImageTaskStateSource): boolean {
  return resolveImageTaskPhase(image) !== 'failed'
    && image.pending === true
}

export function isImageTaskDisplayReady(image: ImageTaskStateSource): boolean {
  const phase = resolveImageTaskPhase(image)
  if (phase === 'failed') return false
  if (phase === 'preview_ready' || phase === 'persisted') return true
  return Boolean(image.previewSrc)
}

export function imageTaskIdentity(image: ImageTaskStateSource): string {
  return String(
    image.gatewayTaskId
    || image.taskId
    || image.galleryId
    || image.id,
  )
}

export function imageTaskSlotIdentity(image: ImageTaskStateSource, slot: number): string {
  return `${imageTaskIdentity(image)}:${slot}`
}
