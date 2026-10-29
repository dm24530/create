const MILLISECONDS_THRESHOLD = 100_000_000_000
const MICROSECONDS_THRESHOLD = 100_000_000_000_000

// Studio slots are kept in microseconds. Older records may contain seconds or
// milliseconds, so normalize them before comparing otherwise mixed generations
// move around after a refresh.
export function normalizeStudioDisplayOrder(value: unknown): number {
  const order = Number(value)
  if (!Number.isFinite(order) || order <= 0) return 0
  if (order >= MICROSECONDS_THRESHOLD) return order
  if (order >= MILLISECONDS_THRESHOLD) return order * 1000
  return order * 1_000_000
}
