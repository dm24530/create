// 视频作品的持久化归档：文件存在对象存储（与图片共用同一份配置，videos/ 前缀），
// 记录存在后端，因此换浏览器、清缓存都还在。
import { apiClient } from '@/api/client'

export interface ArchivedVideoEntry {
  id: string
  url: string
  prompt: string
  model: string
  format: string
  duration_seconds: number
  created_at: number
  expires_at: number
}

export interface ArchiveVideoRequest {
  // 二选一：公开直链交给服务端抓取；浏览器已拿到字节的（如需要密钥的内容接口）直接上传。
  video_url?: string
  video_data_url?: string
  prompt: string
  model: string
  format: string
  duration_seconds: number
}

export async function listArchivedVideos(): Promise<ArchivedVideoEntry[]> {
  const { data } = await apiClient.get<ArchivedVideoEntry[]>('/video-studio/gallery')
  return Array.isArray(data) ? data : []
}

export async function archiveVideo(request: ArchiveVideoRequest): Promise<ArchivedVideoEntry> {
  // 大视频上传 + 服务端转存都要时间，给足超时。
  const { data } = await apiClient.post<ArchivedVideoEntry>('/video-studio/gallery', request, {
    timeout: 10 * 60 * 1000,
  })
  return data
}

export async function deleteArchivedVideo(id: string): Promise<void> {
  await apiClient.delete(`/video-studio/gallery/${encodeURIComponent(id)}`)
}

export interface StudioWorksQuota {
  used: number
  limit: number
}

// 作品配额是图片 + 视频合起来算的（与图片工作台同一份计数）。
export async function fetchStudioWorksQuota(): Promise<StudioWorksQuota> {
  const { data } = await apiClient.get<StudioWorksQuota>('/video-studio/gallery/quota')
  return { used: Number(data?.used || 0), limit: Number(data?.limit || 0) }
}

// 判断一个错误是不是「作品库已满」：后端用 429 + *_QUOTA_EXCEEDED 表达。
export function isStudioQuotaError(error: unknown): boolean {
  const reason = typeof error === 'object' && error !== null && 'reason' in error
    ? String((error as { reason?: unknown }).reason || '')
    : ''
  return reason.endsWith('_QUOTA_EXCEEDED')
}

// 远端素材（在线灵感、模板分镜图）统一走本站代理：
// 页面只有一个来源域名，也顺带拿到服务端缓存。
export function inspirationMediaProxyUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed
  return `/api/v1/public/video-inspiration/media?u=${encodeURIComponent(trimmed)}`
}

export interface InspirationLibraryItem {
  id: string
  type: 'video' | 'image'
  title: string
  prompt: string
  model: string
  category: string
  cover_url: string
  source_cover: string
  width: number
  height: number
  duration_seconds: number
  aspect_ratio: string
  resolution: string
  likes: number
  views: number
  author: string
  author_handle: string
  source_url: string
  has_cover: boolean
}

export interface InspirationLibraryResult {
  items: InspirationLibraryItem[]
  page: number
  page_size: number
  has_more: boolean
  total: number
  models: string[]
  categories: string[]
  fetched_at: number
  stale: boolean
}

export interface InspirationLibraryQuery {
  type?: 'video' | 'image'
  model?: string
  category?: string
  keyword?: string
  page?: number
  pageSize?: number
  refresh?: boolean
}

// 自家灵感站的作品库（服务端拉取 + 快照缓存），支持模型/分类/关键词与分页。
export async function fetchInspirationLibrary(
  query: InspirationLibraryQuery = {},
): Promise<InspirationLibraryResult> {
  const { data } = await apiClient.get<InspirationLibraryResult>('/video-inspiration/library', {
    params: {
      type: query.type ?? 'video',
      model: query.model ?? 'all',
      category: query.category ?? 'all',
      q: query.keyword ?? '',
      page: query.page ?? 1,
      page_size: query.pageSize ?? 24,
      ...(query.refresh ? { refresh: 1 } : {}),
    },
    timeout: 120000,
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    page: Number(data?.page ?? 1) || 1,
    page_size: Number(data?.page_size ?? 24) || 24,
    has_more: Boolean(data?.has_more),
    total: Number(data?.total ?? 0) || 0,
    models: Array.isArray(data?.models) ? data.models : [],
    categories: Array.isArray(data?.categories) ? data.categories : [],
    fetched_at: Number(data?.fetched_at ?? 0) || 0,
    stale: Boolean(data?.stale),
  }
}

export interface OnlineInspirationEntry {
  id: string
  media_type: 'video' | 'image'
  media_url: string
  poster_url: string
  prompt: string
  negative_prompt: string
  model: string
  author: string
  width: number
  height: number
  likes: number
  source_url: string
}

export interface OnlineInspirationFeed {
  items: OnlineInspirationEntry[]
  source: string
  media_type: string
  sort: string
  period: string
  fetched_at: number
  cached: boolean
}

export interface OnlineInspirationQuery {
  mediaType?: 'video' | 'image'
  sort?: 'newest' | 'reactions'
  period?: 'day' | 'week' | 'month' | 'all'
  limit?: number
  refresh?: boolean
}

// 在线灵感由服务端拉取（可走 update.proxy_url 里配的代理），媒体同样经本站代理，
// 因此不再要求访问者自己能连上第三方站点。公开社区每天都有新作品，
// 所以带上 sort/period 让前端能按"最新 / 今天"取，做出日更效果。
export async function fetchOnlineInspirationFeed(
  query: OnlineInspirationQuery = {},
): Promise<OnlineInspirationFeed> {
  const { data } = await apiClient.get<OnlineInspirationFeed>('/video-inspiration/online', {
    // refresh=1 让后端跳过它的短时缓存，「换一批」才有新内容。
    params: {
      type: query.mediaType ?? 'video',
      sort: query.sort ?? 'newest',
      period: query.period ?? 'week',
      limit: query.limit ?? 24,
      ...(query.refresh ? { refresh: 1 } : {}),
    },
    timeout: 60000,
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    source: String(data?.source ?? ''),
    media_type: String(data?.media_type ?? ''),
    sort: String(data?.sort ?? ''),
    period: String(data?.period ?? ''),
    fetched_at: Number(data?.fetched_at ?? 0) || 0,
    cached: Boolean(data?.cached),
  }
}
