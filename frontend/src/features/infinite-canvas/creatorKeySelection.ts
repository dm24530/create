import type { ApiKey } from '@/types'

const IMAGE_STUDIO_PREFERENCES_STORAGE_KEY = 'sub2api:image-studio:preferences'
const VIDEO_STUDIO_PREFERENCES_STORAGE_KEY = 'sub2api:video-studio:preferences'

function canGenerateImages(key: ApiKey) {
  return Boolean(key.key?.trim()) && key.group?.allow_image_generation !== false
}

function canGenerateVideos(key: ApiKey) {
  if (!key.key?.trim()) return false
  const group = key.group
  if (!group) return true
  if (group.video_capable) return true
  if (group.platform === 'composite') return true
  return (
    group.video_price_480p != null ||
    group.video_price_720p != null ||
    group.video_price_1080p != null
  )
}

function isEligibleCreatorKey(key: ApiKey) {
  return key.status === 'active' && canGenerateImages(key)
}

function isEligibleVideoCreatorKey(key: ApiKey) {
  return key.status === 'active' && canGenerateVideos(key)
}

function fallbackCreatorKey(keys: ApiKey[]) {
  return keys.find((key) => isEligibleCreatorKey(key) && key.group?.platform === 'composite')
    || keys.find(isEligibleCreatorKey)
    || null
}

function fallbackVideoCreatorKey(keys: ApiKey[]) {
  return keys.find((key) => isEligibleVideoCreatorKey(key) && key.group?.platform === 'composite')
    || keys.find(isEligibleVideoCreatorKey)
    || null
}

function selectedKeyId(storage: Pick<Storage, 'getItem'>, storageKey: string) {
  try {
    const preferences = JSON.parse(storage.getItem(storageKey) || '{}')
    return typeof preferences?.keyId === 'string' ? preferences.keyId : ''
  } catch {
    return ''
  }
}

export function selectCanvasCreatorKey(
  keys: ApiKey[],
  storage: Pick<Storage, 'getItem'> = localStorage,
  userId?: number | string | null,
): ApiKey | null {
  const storageKey = userId == null
    ? IMAGE_STUDIO_PREFERENCES_STORAGE_KEY
    : `${IMAGE_STUDIO_PREFERENCES_STORAGE_KEY}:${userId}`
  const selectedId = selectedKeyId(storage, storageKey)
  if (selectedId) {
    const selected = keys.find((key) => String(key.id) === selectedId && isEligibleCreatorKey(key))
    if (selected) return selected
  }
  return fallbackCreatorKey(keys)
}

export function selectCanvasVideoCreatorKey(
  keys: ApiKey[],
  storage: Pick<Storage, 'getItem'> = localStorage,
  userId?: number | string | null,
): ApiKey | null {
  const storageKey = userId == null
    ? VIDEO_STUDIO_PREFERENCES_STORAGE_KEY
    : `${VIDEO_STUDIO_PREFERENCES_STORAGE_KEY}:${userId}`
  const selectedId = selectedKeyId(storage, storageKey)
  if (selectedId) {
    const selected = keys.find((key) => String(key.id) === selectedId && isEligibleVideoCreatorKey(key))
    if (selected) return selected
  }
  return fallbackVideoCreatorKey(keys)
}

export function canvasChannelName(key: ApiKey) {
  return key.name?.trim() || '平台 API'
}
