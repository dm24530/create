import { isVideoModel } from '@/features/video-studio/videoStudioApi'

export function isImageGenerationModel(name: string): boolean {
  const value = name.trim().toLowerCase()
  return value.includes('image')
    || value.includes('dall-e')
    || value.includes('flux')
    || value.includes('imagen')
    || value.includes('nano-banana')
    || (value.includes('gemini') && !isVideoModel(value))
}

export function deduplicateModels(names: string[]): string[] {
  const unique = new Map<string, string>()
  for (const rawName of names) {
    const name = rawName.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!unique.has(key)) unique.set(key, name)
  }
  return Array.from(unique.values()).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
  )
}
