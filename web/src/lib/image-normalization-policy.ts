export interface ImageNormalizationSource {
  dataUrl: string
  previewDataUrl?: string
}

export function shouldSkipClientImageNormalization(image: ImageNormalizationSource): boolean {
  if (image.previewDataUrl) return true
  return /^https?:\/\//i.test(image.dataUrl)
}
