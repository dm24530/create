export const GEMINI_REFERENCE_MAX_IMAGES = 14
export const GEMINI_REFERENCE_MAX_IMAGE_BYTES = 1_000_000
export const GEMINI_REFERENCE_TOTAL_BYTES = 10_000_000

export interface GeminiReferenceSource {
  name: string
  blob: Blob
}

export interface GeminiReferenceProfile {
  maxEdge: number
  quality: number
}

export interface GeminiReferenceEncoding {
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

export interface PreparedGeminiReference extends GeminiReferenceEncoding {
  name: string
  mimeType: 'image/webp'
  bytes: number
  profileIndex: number
}

export type GeminiReferenceEncoder = (
  blob: Blob,
  profile: GeminiReferenceProfile,
  profileIndex: number,
) => Promise<GeminiReferenceEncoding>

export interface PrepareGeminiReferenceOptions {
  encoder?: GeminiReferenceEncoder
  onProgress?: (completed: number, total: number) => void
}

export const GEMINI_REFERENCE_PROFILES: readonly GeminiReferenceProfile[] = [
  { maxEdge: 2048, quality: 0.88 },
  { maxEdge: 1600, quality: 0.86 },
  { maxEdge: 1280, quality: 0.82 },
  { maxEdge: 1024, quality: 0.76 },
  { maxEdge: 768, quality: 0.70 },
  { maxEdge: 640, quality: 0.62 },
]

const defaultEncodingCache = new WeakMap<Blob, Map<number, Promise<GeminiReferenceEncoding>>>()

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

export async function prepareGeminiReferenceImages(
  sources: readonly GeminiReferenceSource[],
  options: PrepareGeminiReferenceOptions = {},
): Promise<PreparedGeminiReference[]> {
  if (sources.length > GEMINI_REFERENCE_MAX_IMAGES) {
    throw new Error(`Gemini 参考图最多 ${GEMINI_REFERENCE_MAX_IMAGES} 张`)
  }
  if (!sources.length) {
    options.onProgress?.(0, 0)
    return []
  }

  const encoder = options.encoder || encodeGeminiReference
  const encodedBySource = sources.map(() => new Map<number, Promise<GeminiReferenceEncoding>>())
  const encodeAt = (sourceIndex: number, profileIndex: number) => {
    const cache = encodedBySource[sourceIndex]
    const cached = cache.get(profileIndex)
    if (cached) return cached
    const blob = sources[sourceIndex].blob
    const pending = options.encoder
      ? encoder(blob, GEMINI_REFERENCE_PROFILES[profileIndex], profileIndex)
      : encodeDefaultProfile(blob, profileIndex)
    cache.set(profileIndex, pending)
    return pending
  }

  const bestWithinPerImageCap = async (sourceIndex: number) => {
    for (let profileIndex = 0; profileIndex < GEMINI_REFERENCE_PROFILES.length; profileIndex += 1) {
      const encoded = await encodeAt(sourceIndex, profileIndex)
      if (encoded.blob.size <= GEMINI_REFERENCE_MAX_IMAGE_BYTES) {
        return toPrepared(sources[sourceIndex].name, encoded, profileIndex)
      }
    }
    throw new Error(`${sources[sourceIndex].name} 压缩后仍超过 ${formatMegabytes(GEMINI_REFERENCE_MAX_IMAGE_BYTES)}`)
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
  while (totalBytes >= GEMINI_REFERENCE_TOTAL_BYTES) {
    const candidateIndex = findLargestDowngradeCandidate(prepared)
    if (candidateIndex < 0) {
      throw new Error(
        `14 张以内的参考图压缩后仍达到 ${formatMegabytes(totalBytes)}，请减少图片数量后再试`,
      )
    }
    const current = prepared[candidateIndex]
    let nextProfileIndex = current.profileIndex + 1
    let next: PreparedGeminiReference | null = null
    while (nextProfileIndex < GEMINI_REFERENCE_PROFILES.length) {
      const encoded = await encodeAt(candidateIndex, nextProfileIndex)
      if (encoded.blob.size <= GEMINI_REFERENCE_MAX_IMAGE_BYTES) {
        next = toPrepared(sources[candidateIndex].name, encoded, nextProfileIndex)
        break
      }
      nextProfileIndex += 1
    }
    if (!next) {
      throw new Error(
        `14 张以内的参考图压缩后仍达到 ${formatMegabytes(totalBytes)}，请减少图片数量后再试`,
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
  const pending = encodeGeminiReference(blob, GEMINI_REFERENCE_PROFILES[profileIndex])
  cache.set(profileIndex, pending)
  return pending
}

function findLargestDowngradeCandidate(images: readonly PreparedGeminiReference[]) {
  let index = -1
  let largestBytes = -1
  for (let currentIndex = 0; currentIndex < images.length; currentIndex += 1) {
    const image = images[currentIndex]
    if (image.profileIndex >= GEMINI_REFERENCE_PROFILES.length - 1) continue
    if (image.bytes > largestBytes) {
      largestBytes = image.bytes
      index = currentIndex
    }
  }
  return index
}

function toPrepared(
  name: string,
  encoded: GeminiReferenceEncoding,
  profileIndex: number,
): PreparedGeminiReference {
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

async function encodeGeminiReference(
  blob: Blob,
  profile: GeminiReferenceProfile,
): Promise<GeminiReferenceEncoding> {
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
