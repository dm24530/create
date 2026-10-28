// 我的作品/历史：后端没有视频图库接口，归档保存在浏览器本地。
// 记录任务 ID 与参数，视频地址缺失时可按需重新查询任务或重新下载内容。

import type { VideoProvider, VideoTaskStatus } from './videoStudioApi'

export interface VideoWorkRecord {
  id: string
  provider: VideoProvider
  requestId: string
  keyId: number
  model: string
  prompt: string
  durationSeconds: number
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  referenceCounts: { images: number; videos: number; audios: number }
  videoUrl: string
  // 归档到对象存储后的长期地址（后端记录），换浏览器也能继续播放。
  archivedUrl?: string
  archivedSaved?: boolean
  archivedExpiresAt?: number
  createdAt: number
  status: VideoTaskStatus
  statusMessage: string
}

export const VIDEO_WORKS_STORAGE_KEY = 'sub2api:video-studio:works'

const MAX_RECORDS = 100

export function listVideoWorks(): VideoWorkRecord[] {
  try {
    const stored = JSON.parse(localStorage.getItem(VIDEO_WORKS_STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .filter((item): item is VideoWorkRecord =>
        Boolean(item) && typeof item === 'object' && typeof item.id === 'string' && typeof item.requestId === 'string',
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  } catch {
    return []
  }
}

function writeVideoWorks(records: VideoWorkRecord[]) {
  try {
    localStorage.setItem(
      VIDEO_WORKS_STORAGE_KEY,
      JSON.stringify(records.slice(0, MAX_RECORDS)),
    )
  } catch {
    // 浏览器存储可选，写入失败不影响本次会话的生成结果。
  }
}

export function saveVideoWork(record: VideoWorkRecord): VideoWorkRecord[] {
  const records = listVideoWorks()
  const index = records.findIndex((item) => item.id === record.id)
  if (index >= 0) records.splice(index, 1, { ...records[index], ...record })
  else records.unshift(record)
  const next = records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  writeVideoWorks(next)
  return next
}

export function updateVideoWork(
  id: string,
  patch: Partial<VideoWorkRecord>,
): VideoWorkRecord[] {
  const records = listVideoWorks()
  const index = records.findIndex((item) => item.id === id)
  if (index >= 0) {
    records[index] = { ...records[index], ...patch }
    writeVideoWorks(records)
  }
  return records
}

export function removeVideoWork(id: string): VideoWorkRecord[] {
  const records = listVideoWorks().filter((item) => item.id !== id)
  writeVideoWorks(records)
  return records
}

export function clearVideoWorks(): void {
  try {
    localStorage.removeItem(VIDEO_WORKS_STORAGE_KEY)
  } catch {
    // 忽略存储不可用的场景。
  }
}

export function createVideoWorkId(): string {
  return `vw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
