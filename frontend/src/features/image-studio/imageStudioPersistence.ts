import type { GeneratedImage } from './imageStudioTypes'
import type { ApiKey } from '@/types'

export const PENDING_STORAGE_KEY = 'sub2api:image-studio:pending'
export const FAILED_STORAGE_KEY = 'sub2api:image-studio:failures'
export const PENDING_PROMPT_STORAGE_KEY = 'sub2api:image-studio:pending-prompt'
export const STUDIO_PREFERENCES_STORAGE_KEY = 'sub2api:image-studio:preferences'
export const STUDIO_SNAPSHOT_STORAGE_KEY = 'sub2api:image-studio:snapshot-v1'

export interface ImageStudioPreferences {
  keyId: string
  model: string
}

export interface ImageStudioSnapshot {
  keys: ApiKey[]
  selectedKeyId: string
  imageModels: string[]
  imageModel: string
  images: GeneratedImage[]
}

export function pendingImageStorageKey(userId: number | string) {
  return `${PENDING_STORAGE_KEY}:${userId}`
}

export function failedImageStorageKey(userId: number | string) {
  return `${FAILED_STORAGE_KEY}:${userId}`
}

export function pendingPromptStorageKey(userId: number | string) {
  return `${PENDING_PROMPT_STORAGE_KEY}:${userId}`
}

export function studioPreferencesStorageKey(userId?: number | string) {
  return userId == null
    ? STUDIO_PREFERENCES_STORAGE_KEY
    : `${STUDIO_PREFERENCES_STORAGE_KEY}:${userId}`
}

export function studioSnapshotStorageKey(userId: number | string) {
  return `${STUDIO_SNAPSHOT_STORAGE_KEY}:${userId}`
}

export function readStudioPreferences(
  storage: Storage,
  userId?: number | string,
): ImageStudioPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(studioPreferencesStorageKey(userId)) || '{}')
    return {
      keyId: typeof parsed?.keyId === 'string' ? parsed.keyId : '',
      model: typeof parsed?.model === 'string' ? parsed.model : '',
    }
  } catch {
    return { keyId: '', model: '' }
  }
}

export function writeStudioPreferences(
  storage: Storage,
  userId: number | string | undefined,
  update: Partial<ImageStudioPreferences>,
) {
  try {
    const current = readStudioPreferences(storage, userId)
    storage.setItem(studioPreferencesStorageKey(userId), JSON.stringify({
      ...current,
      ...update,
    }))
  } catch {
    // Persisting UI preferences is optional.
  }
}

export function readStudioSnapshot(
  storage: Storage,
  userId: number | string,
): ImageStudioSnapshot | null {
  try {
    storage.removeItem(STUDIO_SNAPSHOT_STORAGE_KEY)
    const parsed = JSON.parse(storage.getItem(studioSnapshotStorageKey(userId)) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      selectedKeyId: typeof parsed.selectedKeyId === 'string' ? parsed.selectedKeyId : '',
      imageModels: Array.isArray(parsed.imageModels)
        ? parsed.imageModels.filter((item: unknown) => typeof item === 'string')
        : [],
      imageModel: typeof parsed.imageModel === 'string' ? parsed.imageModel : '',
      images: Array.isArray(parsed.images) ? parsed.images : [],
    }
  } catch {
    return null
  }
}

export function writeStudioSnapshot(
  storage: Storage,
  userId: number | string,
  snapshot: ImageStudioSnapshot,
) {
  try {
    storage.setItem(studioSnapshotStorageKey(userId), JSON.stringify(snapshot))
  } catch {
    // A full session storage must not break generation.
  }
}
