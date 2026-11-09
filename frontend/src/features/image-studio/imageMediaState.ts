import type { GeneratedImage } from './imageStudioTypes'

export function isAnimatedImageSource(
  image: Pick<GeneratedImage, 'format' | 'src'>,
  gifFormat: string,
) {
  return String(image.format || '').trim().toLowerCase() === gifFormat
    || /^data:image\/gif(?:;|,)/i.test(image.src)
    || /\.gif(?:[?#]|$)/i.test(image.src)
}

export function resolveImageMediaSource(
  image: Pick<GeneratedImage, 'format' | 'src' | 'thumbSrc'>,
  retryNonce = 0,
  gifFormat = 'gif',
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
) {
  return resolveSource(
    (isAnimatedImageSource(image, gifFormat) ? image.src : image.thumbSrc) || image.src,
    retryNonce,
    origin,
  )
}

export function resolveExplicitImageMediaSource(
  source: string,
  retryNonce = 0,
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
) {
  return resolveSource(source, retryNonce, origin)
}

function resolveSource(source: string, retryNonce: number, origin: string) {
  if (!retryNonce || !/^https?:\/\//i.test(source)) return source
  try {
    const url = new URL(source, origin)
    url.searchParams.set('_retry', String(retryNonce))
    return url.toString()
  } catch {
    return source
  }
}
