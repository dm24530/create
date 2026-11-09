export function sameStoredObject(
  current: string | undefined,
  next: string | undefined,
  origin = 'http://localhost',
): boolean {
  if (!current || !next) return false
  try {
    const currentURL = new URL(current, origin)
    const nextURL = new URL(next, origin)
    return currentURL.origin === nextURL.origin && currentURL.pathname === nextURL.pathname
  } catch {
    return current === next
  }
}

export function stableDisplayOrder(
  current: number | undefined,
  incoming: number | undefined,
): number | undefined {
  const currentOrder = Number(current || 0)
  if (currentOrder > 0) return currentOrder
  const incomingOrder = Number(incoming || 0)
  return incomingOrder > 0 ? incomingOrder : undefined
}

export function sameImageIdentityOrder(
  current: Array<{ id: number | string }>,
  next: Array<{ id: number | string }>,
): boolean {
  return current.length === next.length
    && current.every((image, index) => String(image.id) === String(next[index]?.id))
}
