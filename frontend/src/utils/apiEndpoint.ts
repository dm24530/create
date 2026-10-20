export const DEFAULT_PUBLIC_API_BASE_URL = '/v1'
export const LOCAL_PUBLIC_API_BASE_URL = '/v1'
export const DEFAULT_PUBLIC_SITE_ORIGIN = 'https://create.superai.sbs'
export const DEFAULT_PUBLIC_API_ORIGIN = 'https://create.superai.sbs'

export function resolvePublicApiEndpoint(configured?: string | null): string {
  const trimmed = (configured || '').trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_PUBLIC_API_BASE_URL

  return trimmed
}

export function resolveDocumentedApiBaseUrl(
  configured?: string | null,
  currentOrigin = '',
): string {
  const resolved = resolvePublicApiEndpoint(configured)
  if (/^https?:\/\//i.test(resolved)) return resolved

  const origin = currentOrigin.trim().replace(/\/+$/, '')
  const isLocal = !origin || /\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(origin)
  const publicOrigin = isLocal ? DEFAULT_PUBLIC_API_ORIGIN : origin
  return `${publicOrigin}${resolved.startsWith('/') ? '' : '/'}${resolved}`
}

export function resolvePlaygroundApiEndpoint(configured?: string | null, hostname = ''): string {
  const trimmed = (configured || '').trim()
  if (isLocalHostname(hostname) && (!trimmed || isDefaultPublicApiEndpoint(trimmed))) {
    return LOCAL_PUBLIC_API_BASE_URL
  }
  return resolvePublicApiEndpoint(configured)
}

function isDefaultPublicApiEndpoint(configured: string): boolean {
  return resolvePublicApiEndpoint(configured) === DEFAULT_PUBLIC_API_BASE_URL
}

function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}
