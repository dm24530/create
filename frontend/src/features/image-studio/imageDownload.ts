import { buildApiUrl } from '@/api/url'

const LOCAL_IMAGE_ASSET_PREFIX = '/api/v1/public/image-assets/'

export function resolveImageAssetURL(rawURL: string): string {
  return rawURL.startsWith(LOCAL_IMAGE_ASSET_PREFIX) ? buildApiUrl(rawURL) : rawURL
}

export function imageDownloadURL(
  rawURL: string,
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): string {
  try {
    const url = new URL(resolveImageAssetURL(rawURL), origin)
    if (url.pathname.startsWith(LOCAL_IMAGE_ASSET_PREFIX)) {
      url.searchParams.set('download', '1')
    }
    return url.toString()
  } catch {
    return rawURL
  }
}
