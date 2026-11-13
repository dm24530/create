import type { LocationQuery, LocationQueryValue } from 'vue-router'

const managedCanvasQueryKeys = new Set(['embed', 'user', 'scope'])

export function isCanvasRoutePath(path: string): boolean {
  const normalized = String(path || '').trim()
  return normalized === '/canvas' || normalized.startsWith('/canvas/')
}

export function normalizeCanvasRoutePath(raw: string): string {
  const value = String(raw || '').trim()
  if (!value.startsWith('/canvas')) return ''
  const parsed = new URL(value, 'https://canvas-route.invalid')
  if (!isCanvasRoutePath(parsed.pathname)) return ''
  return `${parsed.pathname}${removeManagedCanvasQuery(parsed.search)}${parsed.hash}`
}

export function canvasPathFromLocation(pathname: string, search = '', hash = ''): string {
  if (!isCanvasRoutePath(pathname)) return ''
  return `${pathname}${removeManagedCanvasQuery(search)}${hash.startsWith('#') ? hash : hash ? `#${hash}` : ''}`
}

export function canvasPathFromVueRoute(
  path: string,
  projectID: unknown,
  query: LocationQuery,
  hash: string,
): string {
  const id = String(projectID || '').trim()
  const routePath = id ? `/canvas/${encodeURIComponent(id)}` : isCanvasRoutePath(path) ? '/canvas' : ''
  if (!routePath) return ''
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    if (managedCanvasQueryKeys.has(key)) continue
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) appendCanvasQueryValue(params, key, value)
  }
  const search = params.toString()
  return `${routePath}${search ? `?${search}` : ''}${normalizeCanvasHash(hash)}`
}

function appendCanvasQueryValue(
  params: URLSearchParams,
  key: string,
  value: LocationQueryValue | LocationQueryValue[] | undefined,
) {
  if (typeof value === 'string' && value !== '') params.append(key, value)
}

function removeManagedCanvasQuery(search: string): string {
  const params = new URLSearchParams(search)
  for (const key of managedCanvasQueryKeys) params.delete(key)
  const value = params.toString()
  return value ? `?${value}` : ''
}

function normalizeCanvasHash(hash: string): string {
  if (!hash) return ''
  return hash.startsWith('#') ? hash : `#${hash}`
}
