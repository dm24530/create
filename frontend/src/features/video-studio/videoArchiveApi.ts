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

// 在线灵感由服务端拉取（可走 update.proxy_url 里配的代理），媒体同样经本站代理，
// 因此不再要求访问者自己能连上第三方站点。
export async function fetchOnlineInspirationsFromServer(
  mediaType: 'video' | 'image' = 'video',
  limit = 24,
  refresh = false,
): Promise<OnlineInspirationEntry[]> {
  const { data } = await apiClient.get<{ items: OnlineInspirationEntry[] }>('/video-inspiration/online', {
    // refresh=1 让后端跳过它的短时缓存，「换一批」才有新内容。
    params: { type: mediaType, limit, ...(refresh ? { refresh: 1 } : {}) },
    timeout: 60000,
  })
  return Array.isArray(data?.items) ? data.items : []
}
