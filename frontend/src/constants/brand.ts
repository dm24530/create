export const DEFAULT_SITE_NAME = 'Create'

const LEGACY_SITE_NAMES = new Set(['sub2api', 'sub2 api', 'sub2-api', 'superai'])

/**
 * Keeps legacy persisted settings from surfacing the old product name.
 * An explicitly configured custom site name is preserved.
 */
export function normalizeSiteName(name?: string | null): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed || LEGACY_SITE_NAMES.has(trimmed.toLowerCase())) {
    return DEFAULT_SITE_NAME
  }
  return trimmed
}
