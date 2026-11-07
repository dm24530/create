const MILLISECONDS_THRESHOLD = 100_000_000_000
const MICROSECONDS_THRESHOLD = 100_000_000_000_000

export interface StudioDisplayOrderItem {
  id?: unknown
  displayOrder?: unknown
  createdAt?: unknown
}

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

function studioItemDisplayOrder(item: StudioDisplayOrderItem): number {
  return normalizeStudioDisplayOrder(item.displayOrder)
    || normalizeStudioDisplayOrder(item.createdAt)
}

// Sort by the immutable generation slot only. Gallery saves, thumbnail loads,
// and server-side status changes must never affect a card's position.
export function sortStudioItemsByDisplayOrder<T extends StudioDisplayOrderItem>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      studioItemDisplayOrder(right.item) - studioItemDisplayOrder(left.item)
      || left.index - right.index
    ))
    .map(({ item }) => item)
}
