export type CreatorKeyKind = 'image' | 'video'

export type CreatorKeyChangedDetail = {
  kind: CreatorKeyKind
  keyId: string
}

export const CREATOR_KEY_CHANGED_EVENT = 'sub2api:creator-key-changed'

export function notifyCreatorKeyChanged(kind: CreatorKeyKind, keyId: string) {
  if (typeof window === 'undefined' || !keyId) return
  window.dispatchEvent(new CustomEvent<CreatorKeyChangedDetail>(CREATOR_KEY_CHANGED_EVENT, {
    detail: { kind, keyId },
  }))
}

export function onCreatorKeyChanged(
  listener: (detail: CreatorKeyChangedDetail) => void,
) {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<CreatorKeyChangedDetail>).detail
    if (!detail?.keyId || (detail.kind !== 'image' && detail.kind !== 'video')) return
    listener(detail)
  }
  window.addEventListener(CREATOR_KEY_CHANGED_EVENT, handler)
  return () => window.removeEventListener(CREATOR_KEY_CHANGED_EVENT, handler)
}
