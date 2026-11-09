import { IMAGE_REFERENCE_MAX_IMAGES } from '@/utils/imageReferenceCompression'

export type GeminiImageQuality = 'auto' | 'high' | 'medium' | 'low'

export interface GeminiImageModelPolicy {
  maxReferences: number
  allowedQualities: readonly GeminiImageQuality[]
  notice: string
}

const ALL_QUALITIES: readonly GeminiImageQuality[] = ['auto', 'high', 'medium', 'low']

export function resolveGeminiImageModelPolicy(model: string): GeminiImageModelPolicy {
  const normalized = model.trim().toLowerCase()

  if (isGemini25FlashImage(normalized)) {
    return {
      maxReferences: 3,
      allowedQualities: ALL_QUALITIES,
      notice: '当前模型最多 3 张参考图，请移除多余图片后再生成。',
    }
  }

  if (normalized.includes('gemini-3.1-flash-lite-image')) {
    return {
      maxReferences: IMAGE_REFERENCE_MAX_IMAGES,
      allowedQualities: ['auto', 'low'],
      notice: '当前模型只支持 1K 输出，请将质量切换为自动或 1K。',
    }
  }

  return {
    maxReferences: IMAGE_REFERENCE_MAX_IMAGES,
    allowedQualities: ALL_QUALITIES,
    notice: '',
  }
}

function isGemini25FlashImage(model: string) {
  return model.includes('gemini-2.5-flash-image') && !model.includes('banana')
}
