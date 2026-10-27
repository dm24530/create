import type { ApiKey } from '@/types'

const IMAGE_STUDIO_PREFERENCES_STORAGE_KEY = 'sub2api:image-studio:preferences'

function canGenerateImages(key: ApiKey) {
  return Boolean(key.key?.trim()) && key.group?.allow_image_generation !== false
}

function isEligibleCreatorKey(key: ApiKey) {
  return key.status === 'active' && canGenerateImages(key)
}

function fallbackCreatorKey(keys: ApiKey[]) {
  return keys.find((key) => isEligibleCreatorKey(key) && key.group?.platform === 'composite')
    || keys.find(isEligibleCreatorKey)
    || null
}

export function selectCanvasCreatorKey(
  keys: ApiKey[],
  storage: Pick<Storage, 'getItem'> = localStorage,
  userId?: number | string | null,
): ApiKey | null {
  try {
    const storageKey = userId == null
      ? IMAGE_STUDIO_PREFERENCES_STORAGE_KEY
      : `${IMAGE_STUDIO_PREFERENCES_STORAGE_KEY}:${userId}`
    const preferences = JSON.parse(storage.getItem(storageKey) || '{}')
    const selectedId = typeof preferences?.keyId === 'string' ? preferences.keyId : ''
    if (selectedId) {
      const selected = keys.find((key) => String(key.id) === selectedId && isEligibleCreatorKey(key))
      if (selected) return selected
    }
    return fallbackCreatorKey(keys)
  } catch {
    return fallbackCreatorKey(keys)
  }
}

export function canvasChannelName(key: ApiKey) {
  return key.name?.trim() || '平台 API'
}
