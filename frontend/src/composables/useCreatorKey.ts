import { keysAPI, userGroupsAPI } from '@/api'
import type { ApiKey, Group } from '@/types'

export type CreatorKind = 'image' | 'video'

export function isCreationServiceUnavailable(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return message.includes('NO_IMAGE_CREATION_SERVICE') || message.includes('NO_VIDEO_CREATION_SERVICE')
}

function supportsImage(group: Group | null | undefined): boolean {
  return Boolean(group) && group?.allow_image_generation === true
}

function supportsVideo(group: Group | null | undefined): boolean {
  if (!group) return false
  if (group.platform === 'composite') return true
  return (
    group.video_price_480p != null ||
    group.video_price_720p != null ||
    group.video_price_1080p != null
  )
}

function supportsKind(key: ApiKey, kind: CreatorKind): boolean {
  return kind === 'image' ? supportsImage(key.group) : supportsVideo(key.group)
}

function supportsGroup(group: Group, kind: CreatorKind): boolean {
  return kind === 'image' ? supportsImage(group) : supportsVideo(group)
}

function prefersComposite<T extends { platform?: string }>(item: T): number {
  return item.platform === 'composite' ? 0 : 1
}

async function listActiveKeys(): Promise<ApiKey[]> {
  const response = await keysAPI.list(1, 100, { status: 'active' })
  return (response.items || []).filter((key) => key.status === 'active')
}

function keyName(kind: CreatorKind, group: Group): string {
  if (group.platform === 'composite') return '创作密钥'
  return kind === 'image' ? '图片创作' : '视频创作'
}

async function createKeyForGroup(kind: CreatorKind, group: Group): Promise<ApiKey> {
  return keysAPI.create(keyName(kind, group), group.id)
}

/**
 * Ensures the current user has an internal creative key for the requested
 * workflow. A composite group is always preferred: one key then routes each
 * request to the provider that owns the selected model.
 *
 * The key stays invisible to consumer-facing studio users.
 */
export async function ensureCreatorKey(kind: CreatorKind): Promise<{ keys: ApiKey[]; key: ApiKey }> {
  const initialKeys = await listActiveKeys()
  const compositeKey = initialKeys.find(
    (key) => key.group?.platform === 'composite' && supportsKind(key, kind),
  )
  if (compositeKey) {
    return { keys: initialKeys, key: compositeKey }
  }

  const groups = await userGroupsAPI.getAvailable()
  const creativeGroups = groups
    .filter((group) => supportsGroup(group, kind))
    .sort((left, right) => prefersComposite(left) - prefersComposite(right))
  const group = creativeGroups[0]

  if (group?.platform === 'composite') {
    const keyInGroup = initialKeys.find(
      (key) => key.group_id === group.id && supportsKind(key, kind),
    )
    if (keyInGroup) {
      return { keys: initialKeys, key: keyInGroup }
    }
    const created = await createKeyForGroup(kind, group)
    return { keys: [...initialKeys, created], key: created }
  }

  const eligible = initialKeys.filter((key) => supportsKind(key, kind))
  if (eligible.length > 0) {
    return { keys: initialKeys, key: eligible[0] }
  }

  if (!group) {
    throw new Error(kind === 'image' ? 'NO_IMAGE_CREATION_SERVICE' : 'NO_VIDEO_CREATION_SERVICE')
  }

  await createKeyForGroup(kind, group)
  const refreshed = await listActiveKeys()
  const created = refreshed.find((key) => supportsKind(key, kind))
  if (!created) {
    throw new Error(kind === 'image' ? 'NO_IMAGE_CREATION_SERVICE' : 'NO_VIDEO_CREATION_SERVICE')
  }
  return { keys: refreshed, key: created }
}
