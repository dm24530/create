import { buildApiUrl } from '@/api/url'

const LOCAL_IMAGE_ASSET_PREFIX = '/api/v1/public/image-assets/'
const IMAGE_TASK_PREVIEW_PREFIX = '/api/v1/public/image-task-previews/'
const IMAGE_TASK_MEDIA_PREFIX = '/api/v1/public/image-task-media/'
const STUDIO_WORK_PREFIX = '/api/v1/public/studio-works/'

export function resolveImageAssetURL(rawURL: string): string {
  return rawURL.startsWith(LOCAL_IMAGE_ASSET_PREFIX)
    || rawURL.startsWith(IMAGE_TASK_PREVIEW_PREFIX)
    || rawURL.startsWith(IMAGE_TASK_MEDIA_PREFIX)
    || rawURL.startsWith(STUDIO_WORK_PREFIX)
    ? buildApiUrl(rawURL)
    : rawURL
}

export function isSafeImagePreviewSource(
  rawURL: string,
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): boolean {
  const value = rawURL.trim()
  if (!value) return false
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return true
  if (value.startsWith('/')) return !value.startsWith('//')
  try {
    return new URL(value, origin).origin === new URL(origin).origin
  } catch {
    return false
  }
}

export function imageDownloadURL(
  rawURL: string,
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): string {
  try {
    const url = new URL(resolveImageAssetURL(rawURL), origin)
    if (
      url.pathname.startsWith(LOCAL_IMAGE_ASSET_PREFIX)
      || url.pathname.startsWith(IMAGE_TASK_PREVIEW_PREFIX)
      || url.pathname.startsWith(IMAGE_TASK_MEDIA_PREFIX)
      || url.pathname.startsWith(STUDIO_WORK_PREFIX)
    ) {
      url.searchParams.set('download', '1')
    }
    return url.toString()
  } catch {
    return rawURL
  }
}
