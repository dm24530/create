export interface GeneratedImage {
  id: number | string
  title: string
  src: string
  originalSrc?: string
  thumbSrc?: string
  thumbSrcSet?: string
  meta: string
  prompt?: string
  model?: string
  size?: string
  format?: string
  quality?: string
  background?: string
  customSizeRequested?: boolean
  pending?: boolean
  taskId?: string
  batchId?: string
  gatewayTaskId?: string
  gatewayPollUrl?: string
  gatewaySubmitPending?: boolean
  previewSrc?: string
  failed?: boolean
  error?: string
  hadReferences?: boolean
  apiKeyId?: number
  startedAt?: number
  durationMs?: number
  saved?: boolean
  expiresAt?: number
  createdAt?: number
  displayOrder?: number
  galleryId?: string
  gallerySourceId?: string
  restoredFromSnapshot?: boolean
}

export interface ReferenceItem {
  id: number
  name: string
  file: File
  preview: string
}

export interface GenerationRequestSnapshot {
  prompt: string
  model: string
  size: string
  quality: string
  format: string
  background: string
  apiKeyId?: number
  appliedSize: SizeSettings
  references: ReferenceItem[]
}

export type SizeMode = 'auto' | 'ratio' | 'custom'

export interface SizeSettings {
  mode: SizeMode
  aspectBase: number
  aspectRatio: string
  useCustomRatio: boolean
  customRatioWidth: number
  customRatioHeight: number
  width: number
  height: number
}
