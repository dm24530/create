export type ExtractedImageResult = {
  b64_json?: string
  url?: string
  mimeType?: string
}

const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'<>]+/g

export function extractGeminiImageResults(payload: unknown): ExtractedImageResult[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, any>
  const candidates = Array.isArray(root.candidates)
    ? root.candidates
    : Array.isArray(root.response?.candidates)
      ? root.response.candidates
      : []
  if (!candidates.length) return []

  const results: ExtractedImageResult[] = []
  for (const candidate of candidates) {
    const inline: ExtractedImageResult[] = []
    const files: ExtractedImageResult[] = []
    const urls: ExtractedImageResult[] = []

    for (const part of candidate?.content?.parts || []) {
      const inlineData = part?.inlineData || part?.inline_data
      const inlineBase64 = typeof inlineData?.data === 'string' ? inlineData.data.trim() : ''
      if (inlineBase64) {
        inline.push({
          b64_json: inlineBase64,
          mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
        })
        continue
      }

      const fileData = part?.fileData || part?.file_data
      const fileURI = typeof fileData?.fileUri === 'string'
        ? fileData.fileUri
        : typeof fileData?.file_uri === 'string'
          ? fileData.file_uri
          : ''
      if (looksLikeImageURL(fileURI)) {
        files.push({
          url: fileURI.trim(),
          mimeType: fileData.mimeType || fileData.mime_type || imageMIMETypeFromURL(fileURI),
        })
        continue
      }

      const text = typeof part?.text === 'string' ? part.text : ''
      for (const rawURL of text.match(IMAGE_URL_PATTERN) || []) {
        const candidateURL = rawURL.replace(/[.,);\]]+$/g, '')
        if (looksLikeImageURL(candidateURL)) {
          urls.push({ url: candidateURL, mimeType: imageMIMETypeFromURL(candidateURL) })
        }
      }
    }

    const candidateResults = inline.length ? inline : files.length ? files : urls
    const seenURLs = new Set<string>()
    for (const result of candidateResults) {
      if (!result.b64_json && result.url) {
        if (seenURLs.has(result.url)) continue
        seenURLs.add(result.url)
      }
      results.push(result)
    }
  }
  return results
}

function looksLikeImageURL(value: string): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return /\.(png|jpe?g|webp|gif|avif)$/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function imageMIMETypeFromURL(value: string): string {
  const lower = value.toLowerCase().split('?')[0]
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.avif')) return 'image/avif'
  return ''
}
