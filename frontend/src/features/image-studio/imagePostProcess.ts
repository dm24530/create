export const LOCAL_IMAGE_MAX_EDGE = 4096

export interface ImageDisplayProcessResult {
  src: string
  format: string
  processed: boolean
  error?: string
}

function parseSize(value: string) {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

function normalizeFormat(value: string) {
  const format = value.trim().toLowerCase().replace('jpg', 'jpeg')
  return ['png', 'jpeg', 'webp'].includes(format) ? format : 'png'
}

export function imageNeedsLocalResize(value: string, upstreamMaxEdge: number) {
  const dimensions = parseSize(value)
  if (!dimensions) return false
  return dimensions.width > upstreamMaxEdge || dimensions.height > upstreamMaxEdge
}

function dataUrlToBlob(src: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(src)
  if (!match) throw new Error('invalid data URL')
  const mime = match[1] || 'application/octet-stream'
  const payload = match[3] || ''
  const binary = match[2]
    ? atob(payload)
    : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime })
}

async function loadSourceBlob(src: string) {
  if (src.startsWith('data:')) return dataUrlToBlob(src)
  const response = await fetch(src, { credentials: 'omit' })
  if (!response.ok) throw new Error(`image download failed: ${response.status}`)
  return response.blob()
}

async function decodeSource(src: string, blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap as CanvasImageSource,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    }
  }

  const objectURL = src.startsWith('data:') ? '' : URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  image.src = objectURL || src
  try {
    if (typeof image.decode === 'function') {
      await image.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('image decode failed'))
      })
    }
  } catch (error) {
    if (objectURL) URL.revokeObjectURL(objectURL)
    throw error
  }
  return {
    source: image as CanvasImageSource,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => {
      if (objectURL) URL.revokeObjectURL(objectURL)
    },
  }
}

export async function processImageForDisplay(
  src: string,
  targetSize: string,
  targetFormat: string,
): Promise<ImageDisplayProcessResult> {
  const format = normalizeFormat(targetFormat)
  const target = parseSize(targetSize)
  if (!target?.width || !target?.height) {
    return { src, format, processed: false }
  }

  let cleanup = () => {}
  try {
    const blob = await loadSourceBlob(src)
    const decoded = await decodeSource(src, blob)
    cleanup = decoded.cleanup
    if (!decoded.width || !decoded.height) throw new Error('image dimensions are unavailable')

    const scale = Math.max(target.width / decoded.width, target.height / decoded.height)
    const drawWidth = decoded.width * scale
    const drawHeight = decoded.height * scale
    const offsetX = (target.width - drawWidth) / 2
    const offsetY = (target.height - drawHeight) / 2

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas is unavailable')
    if (format === 'jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, target.width, target.height)
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(decoded.source, offsetX, offsetY, drawWidth, drawHeight)

    const mime = `image/${format}`
    const output = canvas.toDataURL(mime, 0.94)
    if (!output.startsWith(`data:${mime};`)) throw new Error('image encoding failed')
    return { src: output, format, processed: true }
  } catch (error) {
    return {
      src,
      format,
      processed: false,
      error: error instanceof Error ? error.message : 'image processing failed',
    }
  } finally {
    cleanup()
  }
}
