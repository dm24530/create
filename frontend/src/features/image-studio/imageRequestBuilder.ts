import { extractGeminiImageResults } from './geminiImageResults'
import { prefersURLImageResponse } from './imageModelPolicy'
import type { ReferenceItem, SizeSettings } from './imageStudioTypes'
import type { PreparedImageReference } from '@/utils/imageReferenceCompression'

export interface ImageRequestSettings {
  model: string
  size: string
  quality: string
  format: string
  background: string
}

export function imageResponseFormatForModel(model: string) {
  return prefersURLImageResponse(model) ? 'url' : 'b64_json'
}

export function buildImageGenerationPayload(
  text: string,
  settings: ImageRequestSettings,
) {
  return {
    model: settings.model,
    prompt: text,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.format,
    background: settings.background,
    n: 1,
    response_format: imageResponseFormatForModel(settings.model),
  }
}

export function buildGeminiURL(
  apiBaseUrl: string,
  model: string,
  platform?: string,
) {
  const root = apiBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  const prefix = platform === 'antigravity' ? '/antigravity/v1beta' : '/v1beta'
  return `${root}${prefix}/models/${encodeURIComponent(model)}:generateContent`
}

export function buildGeminiPayload(
  text: string,
  preparedReferences: readonly PreparedImageReference[],
  options: {
    size: string
    quality: string
    appliedSize: SizeSettings
  },
) {
  const parts: any[] = []
  preparedReferences.forEach((item, index) => {
    parts.push({ text: `图片${index + 1}` })
    if (item.remoteUrl) {
      parts.push({
        fileData: {
          mimeType: item.mimeType,
          fileUri: item.remoteUrl,
        },
      })
      return
    }
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(item.dataUrl)
    parts.push(match
      ? { inlineData: { mimeType: item.mimeType, data: match[2] } }
      : { text: item.name })
  })
  parts.push({ text })
  const imageConfig: Record<string, string> = {
    aspectRatio: geminiAspectRatio(options.size, options.appliedSize),
  }
  const imageSize = geminiImageSizeForQuality(options.quality)
  if (imageSize) imageConfig.imageSize = imageSize
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig,
    },
  }
}

export function geminiImageSizeForQuality(value: string) {
  if (value === 'high') return '4K'
  if (value === 'medium') return '2K'
  if (value === 'low') return '1K'
  return undefined
}

export function geminiAspectRatio(value: string, settings: SizeSettings) {
  if (settings.mode === 'ratio') {
    return settings.useCustomRatio
      ? `${settings.customRatioWidth}:${settings.customRatioHeight}`
      : settings.aspectRatio
  }
  if (value === 'auto') return '1:1'
  const dimensions = parseImageSize(value)
  if (!dimensions) return '1:1'
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height)
  return `${Math.round(dimensions.width / divisor)}:${Math.round(dimensions.height / divisor)}`
}

export function buildEditURLPayload(
  text: string,
  imageURLs: readonly string[],
  settings: ImageRequestSettings,
) {
  return {
    ...buildImageGenerationPayload(text, settings),
    images: imageURLs.map((imageURL) => ({ image_url: imageURL })),
  }
}

export function buildEditForm(
  text: string,
  preparedReferences: readonly PreparedImageReference[],
  settings: ImageRequestSettings,
  fallbackReferences: readonly ReferenceItem[] = [],
) {
  const form = new FormData()
  form.append('model', settings.model)
  form.append('prompt', text)
  form.append('size', settings.size)
  form.append('quality', settings.quality)
  form.append('output_format', settings.format)
  form.append('background', settings.background)
  form.append('n', '1')
  form.append('response_format', imageResponseFormatForModel(settings.model))
  if (preparedReferences.length) {
    preparedReferences.forEach((item, index) => {
      form.append('image[]', item.blob, compressedReferenceFileName(item.name, index))
    })
  } else {
    fallbackReferences.forEach((item) => form.append('image[]', item.file, item.name))
  }
  return form
}

export function compressedReferenceFileName(name: string, index: number) {
  const base = String(name || '').replace(/\.[^.]+$/, '').trim() || `reference-${index + 1}`
  return `${base}.webp`
}

export function extractImages(payload: any): any[] {
  if (!payload) return []
  if (Array.isArray(payload.data)) return payload.data.flatMap(extractImages)
  const geminiResults = extractGeminiImageResults(payload)
  if (geminiResults.length) return geminiResults
  if (Array.isArray(payload.response?.output)) return payload.response.output
  if (Array.isArray(payload.output)) return payload.output
  if (
    payload.b64_json
    || payload.preview_data_url
    || payload.preview_url
    || payload.display_url
    || payload.url
    || payload.result
  ) {
    return [payload]
  }
  return []
}

function parseImageSize(value: string) {
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(value.trim())
  if (!match) return null
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

export function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? Math.max(1, a) : greatestCommonDivisor(b, a % b)
}
