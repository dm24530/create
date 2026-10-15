import { i18n } from '@/i18n'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

const DEFAULT_DESCRIPTION = 'Create 是一个 AI 视频与图片生成平台，支持 AI 视频生成、AI 图片生成与作品管理。'

const DEFAULT_KEYWORDS = [
  'Create',
  'AI 视频生成',
  'AI 图片生成',
  '视频生成',
  '图片生成',
  'AI 视频与图片生成平台',
  'AI 创作平台',
]

export interface DocumentSeo {
  title: string
  description: string
  keywords: string[]
  canonical: string
  robots: string
}

export function resolveRouteSeo(
  route: Pick<RouteLocationNormalizedLoaded, 'path' | 'meta'>,
  title: string,
  origin: string,
): DocumentSeo {
  const descriptionKey = typeof route.meta.descriptionKey === 'string' ? route.meta.descriptionKey : ''
  const translatedDescription = descriptionKey ? String(i18n.global.t(descriptionKey)) : ''
  const description = translatedDescription && translatedDescription !== descriptionKey
    ? translatedDescription
    : DEFAULT_DESCRIPTION
  const keywords = Array.isArray(route.meta.seoKeywords) && route.meta.seoKeywords.length > 0
    ? route.meta.seoKeywords
    : DEFAULT_KEYWORDS
  const isPublic = route.meta.requiresAuth === false

  return {
    title,
    description,
    keywords,
    canonical: new URL(route.path || '/', origin).toString(),
    robots: isPublic ? 'index,follow' : 'noindex,nofollow',
  }
}

export function applyDocumentSeo(seo: DocumentSeo) {
  if (typeof document === 'undefined') return
  document.title = seo.title
  setMeta('name', 'description', seo.description)
  setMeta('name', 'keywords', seo.keywords.join(','))
  setMeta('name', 'robots', seo.robots)
  setMeta('property', 'og:title', seo.title)
  setMeta('property', 'og:description', seo.description)
  setMeta('property', 'og:url', seo.canonical)
  setMeta('property', 'og:type', 'website')
  setMeta('name', 'twitter:card', 'summary')
  setMeta('name', 'twitter:title', seo.title)
  setMeta('name', 'twitter:description', seo.description)
  setCanonical(seo.canonical)
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function setCanonical(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }
  element.setAttribute('href', url)
}
