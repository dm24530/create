export const IMAGE_CONSTRAINTS = {
  minEdge: 256,
  maxEdge: 3840,
  minPixels: 655_360,
  maxPixels: 8_294_400,
} as const

export function fitImageSizeToWindow(rawWidth: number, rawHeight: number) {
  const minEdge = IMAGE_CONSTRAINTS.minEdge
  const maxEdge = IMAGE_CONSTRAINTS.maxEdge
  const minPixels = IMAGE_CONSTRAINTS.minPixels
  const maxPixels = IMAGE_CONSTRAINTS.maxPixels
  const safeWidth = Math.max(minEdge, Number(rawWidth) || minEdge)
  const safeHeight = Math.max(minEdge, Number(rawHeight) || minEdge)
  const edgeFactor = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight))
  let width = normalizeImageDimension(safeWidth * edgeFactor, maxEdge)
  let height = normalizeImageDimension(safeHeight * edgeFactor, maxEdge)

  for (let guard = 0; guard < 128 && width * height > maxPixels; guard += 1) {
    const factor = Math.sqrt(maxPixels / (width * height))
    const nextWidth = Math.max(minEdge, Math.floor(width * factor / 16) * 16)
    const nextHeight = Math.max(minEdge, Math.floor(height * factor / 16) * 16)
    if (nextWidth === width && nextHeight === height) break
    width = nextWidth
    height = nextHeight
  }

  for (let guard = 0; guard < 128 && width * height < minPixels; guard += 1) {
    const edgeRoom = Math.max(1, maxEdge / Math.max(width, height))
    const factor = Math.min(Math.sqrt(minPixels / (width * height)), edgeRoom)
    const nextWidth = Math.min(maxEdge, Math.ceil(width * factor / 16) * 16)
    const nextHeight = Math.min(maxEdge, Math.ceil(height * factor / 16) * 16)
    if (nextWidth === width && nextHeight === height) break
    width = nextWidth
    height = nextHeight
  }

  return { width, height }
}

export function validateImageSize(value: string) {
  if (!value || value === 'auto') return ''
  const parsed = parseImageSizeValue(value)
  if (!parsed) return '尺寸格式无法识别'
  const { minEdge, maxEdge, minPixels, maxPixels } = IMAGE_CONSTRAINTS
  const { width, height } = parsed
  const longest = Math.max(width, height)
  const shortest = Math.min(width, height)
  if (shortest < minEdge || longest > maxEdge) {
    return `边长需在 ${minEdge}~${maxEdge} 之间`
  }
  if (width % 16 !== 0 || height % 16 !== 0) return '边长必须是 16 的倍数'
  if (longest / shortest > 3) return '长短边比不能超过 3:1'
  const pixels = width * height
  if (pixels < minPixels) return `总像素 ${pixels} 低于下限 ${minPixels}`
  if (pixels > maxPixels) {
    return `总像素 ${pixels} 超过上限 ${maxPixels}（3840x2160）`
  }
  return ''
}

export function normalizeImageDimension(
  value: number,
  maxEdge: number = IMAGE_CONSTRAINTS.maxEdge,
) {
  return Math.round(clampImageDimension(value, maxEdge) / 16) * 16
}

export function clampImageDimension(
  value: number,
  maxEdge: number = IMAGE_CONSTRAINTS.maxEdge,
) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 1024
  return Math.round(
    Math.min(maxEdge, Math.max(IMAGE_CONSTRAINTS.minEdge, numeric)),
  )
}

export function parseImageSizeValue(value: string) {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  if (!match) return null
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}
