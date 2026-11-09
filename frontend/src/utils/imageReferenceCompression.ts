export const IMAGE_REFERENCE_MAX_IMAGES = 14
export const IMAGE_REFERENCE_MAX_IMAGE_BYTES = 1_000_000
export const IMAGE_REFERENCE_TOTAL_BYTES = 10_000_000
export const IMAGE_REFERENCE_FAST_IMAGE_BYTES = 200_000

export interface ImageReferenceSource {
  name: string
  blob: Blob
}

export interface ImageReferenceProfile {
  maxEdge: number
  quality: number
}

export interface ImageReferenceEncoding {
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

export interface PreparedImageReference extends ImageReferenceEncoding {
  name: string
  mimeType: 'image/webp'
  bytes: number
  profileIndex: number
  remoteUrl?: string
}

export type ImageReferenceEncoder = (
  blob: Blob,
  profile: ImageReferenceProfile,
  profileIndex: number,
) => Promise<ImageReferenceEncoding>

export interface PrepareImageReferenceOptions {
  encoder?: ImageReferenceEncoder
  onProgress?: (completed: number, total: number) => void
  profiles?: readonly ImageReferenceProfile[]
  maxImageBytes?: number
}

export const IMAGE_REFERENCE_PROFILES: readonly ImageReferenceProfile[] = [
  { maxEdge: 2048, quality: 0.88 },
  { maxEdge: 1600, quality: 0.86 },
  { maxEdge: 1280, quality: 0.82 },
  { maxEdge: 1024, quality: 0.76 },
  { maxEdge: 768, quality: 0.70 },
  { maxEdge: 640, quality: 0.62 },
]

export const IMAGE_REFERENCE_FAST_PROFILES: readonly ImageReferenceProfile[] = [
  { maxEdge: 1024, quality: 0.72 },
  { maxEdge: 768, quality: 0.62 },
  { maxEdge: 640, quality: 0.55 },
  { maxEdge: 512, quality: 0.48 },
]

const defaultEncodingCache = new WeakMap<Blob, Map<number, Promise<ImageReferenceEncoding>>>()

export function fitReferenceDimensions(width: number, height: number, maxEdge: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('参考图尺寸无效')
  }
  const longestEdge = Math.max(width, height)
  const scale = Math.min(1, Math.max(1, maxEdge) / longestEdge)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function prepareImageReferenceImages(
  sources: readonly ImageReferenceSource[],
  options: PrepareImageReferenceOptions = {},
): Promise<PreparedImageReference[]> {
  if (sources.length > IMAGE_REFERENCE_MAX_IMAGES) {
    throw new Error(`参考图最多 ${IMAGE_REFERENCE_MAX_IMAGES} 张`)
  }
  if (!sources.length) {
    options.onProgress?.(0, 0)
    return []
  }

  const encoder = options.encoder || encodeImageReference
  const profiles = options.profiles || IMAGE_REFERENCE_PROFILES
  const maxImageBytes = options.maxImageBytes || IMAGE_REFERENCE_MAX_IMAGE_BYTES
  const encodedBySource = sources.map(() => new Map<number, Promise<ImageReferenceEncoding>>())
  const encodeAt = (sourceIndex: number, profileIndex: number) => {
    const cache = encodedBySource[sourceIndex]
    const cached = cache.get(profileIndex)
    if (cached) return cached
    const blob = sources[sourceIndex].blob
    const pending = options.encoder
      ? encoder(blob, profiles[profileIndex], profileIndex)
      : profiles === IMAGE_REFERENCE_PROFILES
        ? encodeDefaultProfile(blob, profileIndex)
        : encodeImageReference(blob, profiles[profileIndex])
    cache.set(profileIndex, pending)
    return pending
  }

  const bestWithinPerImageCap = async (sourceIndex: number) => {
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
      const encoded = await encodeAt(sourceIndex, profileIndex)
      if (encoded.blob.size <= maxImageBytes) {
        return toPrepared(sources[sourceIndex].name, encoded, profileIndex)
      }
    }
    throw new Error(`${sources[sourceIndex].name} 压缩后仍超过 ${formatMegabytes(maxImageBytes)}`)
  }

  let completed = 0
  const prepared = await mapWithConcurrency(
    sources.map((_, index) => index),
    2,
    async (sourceIndex) => {
      const image = await bestWithinPerImageCap(sourceIndex)
      completed += 1
      options.onProgress?.(completed, sources.length)
      return image
    },
  )

  let totalBytes = prepared.reduce((total, image) => total + image.bytes, 0)
  while (totalBytes >= IMAGE_REFERENCE_TOTAL_BYTES) {
    const candidateIndex = findLargestDowngradeCandidate(prepared, profiles.length)
    if (candidateIndex < 0) {
      throw new Error(
        `参考图压缩后仍达到 ${formatMegabytes(totalBytes)}，请减少图片数量后再试`,
      )
    }
    const current = prepared[candidateIndex]
    let nextProfileIndex = current.profileIndex + 1
    let next: PreparedImageReference | null = null
    while (nextProfileIndex < profiles.length) {
      const encoded = await encodeAt(candidateIndex, nextProfileIndex)
      if (encoded.blob.size <= maxImageBytes) {
        next = toPrepared(sources[candidateIndex].name, encoded, nextProfileIndex)
        break
      }
      nextProfileIndex += 1
    }
    if (!next) {
      throw new Error(
        `参考图压缩后仍达到 ${formatMegabytes(totalBytes)}，请减少图片数量后再试`,
      )
    }
    totalBytes += next.bytes - current.bytes
    prepared[candidateIndex] = next
  }

  return prepared
}

function encodeDefaultProfile(blob: Blob, profileIndex: number) {
  let cache = defaultEncodingCache.get(blob)
  if (!cache) {
    cache = new Map()
    defaultEncodingCache.set(blob, cache)
  }
  const cached = cache.get(profileIndex)
  if (cached) return cached
  const pending = encodeImageReference(blob, IMAGE_REFERENCE_PROFILES[profileIndex])
  cache.set(profileIndex, pending)
  return pending
}

function findLargestDowngradeCandidate(
  images: readonly PreparedImageReference[],
  profileCount: number,
) {
  let index = -1
  let largestBytes = -1
  for (let currentIndex = 0; currentIndex < images.length; currentIndex += 1) {
    const image = images[currentIndex]
    if (image.profileIndex >= profileCount - 1) continue
    if (image.bytes > largestBytes) {
      largestBytes = image.bytes
      index = currentIndex
    }
  }
  return index
}

function toPrepared(
  name: string,
  encoded: ImageReferenceEncoding,
  profileIndex: number,
): PreparedImageReference {
  return {
    name,
    blob: encoded.blob,
    dataUrl: encoded.dataUrl,
    width: encoded.width,
    height: encoded.height,
    bytes: encoded.blob.size,
    mimeType: 'image/webp',
    profileIndex,
  }
}

async function encodeImageReference(
  blob: Blob,
  profile: ImageReferenceProfile,
): Promise<ImageReferenceEncoding> {
  const bitmap = await createImageBitmap(blob)
  try {
    const { width, height } = fitReferenceDimensions(bitmap.width, bitmap.height, profile.maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法压缩参考图')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const encoded = await canvasToBlob(canvas, 'image/webp', profile.quality)
    return {
      blob: encoded,
      dataUrl: await blobToDataURL(encoded),
      width,
      height,
    }
  } finally {
    bitmap.close()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('参考图压缩失败'))
        return
      }
      resolve(blob)
    }, mimeType, quality)
  })
}

function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('参考图编码失败'))
    reader.readAsDataURL(blob)
  })
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(values[index], index)
      }
    },
  )
  await Promise.all(workers)
  return results
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
