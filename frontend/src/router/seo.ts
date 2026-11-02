import { i18n } from '@/i18n'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { DEFAULT_SITE_NAME } from '@/constants/brand'

const DEFAULT_KEYWORDS = [
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
  siteName: string
}

export function resolveRouteSeo(
  route: Pick<RouteLocationNormalizedLoaded, 'path' | 'meta'>,
  title: string,
  origin: string,
  siteName = DEFAULT_SITE_NAME,
  siteSEOKeywords = '',
): DocumentSeo {
  const primarySiteName = siteName.trim() || DEFAULT_SITE_NAME
  const aliases = buildBrandAliases(primarySiteName, siteSEOKeywords)
  const introBrand = buildBrandIntro(primarySiteName, aliases)
  const descriptionKey = typeof route.meta.descriptionKey === 'string' ? route.meta.descriptionKey : ''
  const translatedDescription = descriptionKey
    ? String(i18n.global.t(descriptionKey, { siteName: introBrand }))
    : ''
  const description = translatedDescription && translatedDescription !== descriptionKey
    ? translatedDescription
    : `${introBrand} 是一个 AI 视频与图片生成平台，支持 AI 视频生成、AI 图片生成与作品管理。`
  const routeKeywords = Array.isArray(route.meta.seoKeywords) && route.meta.seoKeywords.length > 0
    ? route.meta.seoKeywords
    : DEFAULT_KEYWORDS
  const keywords = buildKeywords(primarySiteName, aliases, routeKeywords)
  const isPublic = route.meta.requiresAuth === false
  const canonicalPath = route.path === '/' ? '/home' : (route.path || '/home')

  return {
    title,
    description,
    keywords,
    canonical: new URL(canonicalPath, origin).toString(),
    robots: isPublic ? 'index,follow' : 'noindex,nofollow',
    siteName: primarySiteName,
  }
}

export function applyDocumentSeo(seo: DocumentSeo) {
  if (typeof document === 'undefined') return
  document.title = seo.title
  setMeta('name', 'description', seo.description)
  setMeta('name', 'keywords', seo.keywords.join(','))
  setMeta('name', 'robots', seo.robots)
  setMeta('name', 'application-name', seo.siteName)
  setMeta('property', 'og:site_name', seo.siteName)
  setMeta('property', 'og:title', seo.title)
  setMeta('property', 'og:description', seo.description)
  setMeta('property', 'og:url', seo.canonical)
  setMeta('property', 'og:type', 'website')
  setMeta('name', 'twitter:card', 'summary')
  setMeta('name', 'twitter:title', seo.title)
  setMeta('name', 'twitter:description', seo.description)
  setCanonical(seo.canonical)
}

function buildBrandAliases(siteName: string, rawKeywords: string): string[] {
  const values = [siteName, ...rawKeywords.split(/[,，;；\r\n\t]+/)]
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function buildBrandIntro(siteName: string, aliases: string[]): string {
  const alias = aliases.slice(1).find((value) => value.toLowerCase() !== siteName.toLowerCase())
  return alias ? `${siteName}（又称 ${alias}）` : siteName
}

function buildKeywords(siteName: string, aliases: string[], routeKeywords: string[]): string[] {
  const candidates = [
    siteName,
    ...aliases,
    ...routeKeywords,
    ...aliases.flatMap((alias) => [
      `${alias} AI`,
      `${alias} AI 视频生成`,
      `${alias} AI 图片生成`,
      `${alias} 视频生成`,
      `${alias} 图片生成`,
      `${alias} video generator`,
      `${alias} image generator`,
    ]),
  ]
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
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
