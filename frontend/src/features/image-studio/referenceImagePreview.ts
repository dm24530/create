import { fitReferenceDimensions } from '@/utils/imageReferenceCompression'

export const REFERENCE_PREVIEW_MAX_EDGE = 320
export const REFERENCE_PREVIEW_QUALITY = 0.72

export async function createReferenceImagePreview(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  try {
    const { width, height } = fitReferenceDimensions(
      bitmap.width,
      bitmap.height,
      REFERENCE_PREVIEW_MAX_EDGE,
    )
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法生成参考图预览')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', REFERENCE_PREVIEW_QUALITY)
  } finally {
    bitmap.close()
  }
}
