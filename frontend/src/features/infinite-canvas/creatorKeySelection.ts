import type { ApiKey } from '@/types'

const IMAGE_STUDIO_PREFERENCES_STORAGE_KEY = 'sub2api:image-studio:preferences'

function canGenerateImages(key: ApiKey) {
  return Boolean(key.key?.trim()) && key.group?.allow_image_generation !== false
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
    if (!selectedId) return null
    return keys.find((key) => (
      String(key.id) === selectedId
      && key.status === 'active'
      && canGenerateImages(key)
    )) || null
  } catch {
    return null
  }
}

export function canvasChannelName(key: ApiKey) {
  return key.name?.trim() || '平台 API'
}
