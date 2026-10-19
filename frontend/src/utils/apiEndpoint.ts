export const DEFAULT_PUBLIC_API_BASE_URL = '/v1'
export const LOCAL_PUBLIC_API_BASE_URL = '/v1'

export function resolvePublicApiEndpoint(configured?: string | null): string {
  const trimmed = (configured || '').trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_PUBLIC_API_BASE_URL

  return trimmed
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
