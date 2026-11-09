export function isImageModelName(name: string) {
  const value = name.trim().toLowerCase()
  return value.startsWith('gpt-image-')
    || value.includes('dall-e')
    || value.includes('image')
    || value.includes('nano-banana')
    || value.includes('banana')
    || value.includes('imagen')
    || value.includes('flux')
    || value.includes('sdxl')
}

export function isGrokImageModelName(name: string) {
  const value = name.trim().toLowerCase()
  return value.includes('grok-imagine') && !value.includes('video')
}

export function deduplicateImageModelNames(names: string[]) {
  const unique = new Map<string, string>()
  for (const rawName of names) {
    const name = rawName.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!unique.has(key)) unique.set(key, name)
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

export function isGeminiImageModelName(name: string) {
  const value = name.toLowerCase()
  return value.includes('banana') || (value.includes('gemini') && isImageModelName(name))
}
