import type { GeneratedImage } from './imageStudioTypes'
import {
  sameStoredObject,
  stableDisplayOrder,
} from './imageGalleryState'
import { sortStudioItemsByDisplayOrder } from '@/features/studioDisplayOrder'

export interface GalleryMergeEntry {
  id: string
  source_id?: string
  url?: string
  thumb_url?: string
  prompt?: string
  model?: string
  size?: string
  format?: string
  saved?: boolean
  expires_at?: number
  duration_ms?: number
  created_at?: number
  sort_order?: number
}

interface ImageGalleryMergeOptions {
  localToGalleryId: ReadonlyMap<string, string>
  locallySavedGalleryIds: ReadonlySet<string>
  createGalleryImage: (entry: GalleryMergeEntry, index: number) => GeneratedImage
  origin?: string
  resolveEntryURL?: (url: string) => string
  matchesFallback?: (image: GeneratedImage, entry: GalleryMergeEntry) => boolean
}

export function mergeImageGallery(
  current: GeneratedImage[],
  entries: GalleryMergeEntry[],
  options: ImageGalleryMergeOptions,
) {
  const origin = options.origin
    || (typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
  const resolveURL = options.resolveEntryURL || ((url: string) => url)
  const matchedGalleryIds = new Set<string>()
  const matchedImageGalleryIds = new Map<string, string>()
  const changedMediaIds = new Set<string>()

  for (const image of current) {
    const localId = String(image.id)
    const entry = entries.find((candidate) => (
      String(candidate.id) === localId
      || String(candidate.id) === String(image.galleryId || '')
      || Boolean(candidate.source_id && candidate.source_id === image.gallerySourceId)
      || options.localToGalleryId.get(localId) === String(candidate.id)
      || sameStoredObject(image.src, resolveURL(String(candidate.url || '')), origin)
      || options.matchesFallback?.(image, candidate)
    ))
    if (!entry) continue

    matchedGalleryIds.add(String(entry.id))
    matchedImageGalleryIds.set(localId, String(entry.id))
    image.galleryId = String(entry.id)
    image.gallerySourceId = entry.source_id || image.gallerySourceId
    const storedURL = resolveURL(String(entry.url || ''))
    if (
      storedURL
      && !isInlineSource(image.src)
      && !sameStoredObject(image.src, storedURL, origin)
    ) {
      image.src = storedURL
      changedMediaIds.add(localId)
    }
    const storedThumbURL = String(entry.thumb_url || '')
    if (
      storedThumbURL
      && !isInlineSource(image.thumbSrc)
      && !sameStoredObject(image.thumbSrc, storedThumbURL, origin)
    ) {
      image.thumbSrc = storedThumbURL
      image.thumbSrcSet = ''
      changedMediaIds.add(localId)
    }
    image.prompt = entry.prompt
    image.model = entry.model
    image.size = entry.size
    image.format = entry.format
    image.saved = entry.saved !== false
    image.expiresAt = entry.expires_at || 0
    image.durationMs = Number(entry.duration_ms || 0) || image.durationMs
    image.createdAt = entry.created_at || image.createdAt
    image.displayOrder = stableDisplayOrder(image.displayOrder, entry.sort_order)
  }

  const seen = new Set<string>()
  const gallery = entries
    .filter((entry) => !options.locallySavedGalleryIds.has(String(entry.id)))
    .filter((entry) => !matchedGalleryIds.has(String(entry.id)))
    .map((entry, index) => options.createGalleryImage(entry, index))
    .filter((image) => {
      const key = String(image.id || image.src)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  const merged = [...current, ...gallery].filter((image, index, all) => {
    const key = String(image.id || image.src)
    return all.findIndex((candidate) => String(candidate.id || candidate.src) === key) === index
  })

  return {
    images: sortStudioItemsByDisplayOrder(merged),
    matchedGalleryIds,
    matchedImageGalleryIds,
    changedMediaIds,
  }
}

function isInlineSource(value: string | undefined) {
  return Boolean(value && (/^data:image\//i.test(value) || /^blob:/i.test(value)))
}
