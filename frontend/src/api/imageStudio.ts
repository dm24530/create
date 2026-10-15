import { apiClient } from './client'

export interface ImageStudioGalleryEntry {
  id: string
  url: string
  prompt: string
  model: string
  size: string
  format: string
  created_at: number
  expires_at: number
}

export interface SaveImageStudioGalleryRequest {
  image_data_url?: string
  image_url?: string
  prompt: string
  model: string
  size: string
  format: string
}

export async function listImageStudioGallery(): Promise<ImageStudioGalleryEntry[]> {
  const { data } = await apiClient.get<ImageStudioGalleryEntry[]>('/image-studio/gallery')
  return data
}

export async function saveImageStudioGallery(
  request: SaveImageStudioGalleryRequest,
): Promise<ImageStudioGalleryEntry> {
  // Saving includes uploading the image to object storage, which can take several minutes.
  const { data } = await apiClient.post<ImageStudioGalleryEntry>('/image-studio/gallery', request, {
    timeout: 5 * 60 * 1000,
  })
  return data
}

// 删除一条作品：后端会把对象存储里的文件一起删掉，操作不可撤销。
export async function deleteImageStudioGallery(id: string): Promise<void> {
  await apiClient.delete(`/image-studio/gallery/${encodeURIComponent(id)}`)
}

export interface StudioWorksQuota {
  used: number
  limit: number
}

// 作品配额是图片 + 视频合起来算的，两个工作台调同一个计数。
export async function fetchStudioWorksQuota(): Promise<StudioWorksQuota> {
  const { data } = await apiClient.get<StudioWorksQuota>('/image-studio/gallery/quota')
  return { used: Number(data?.used || 0), limit: Number(data?.limit || 0) }
}

export const imageStudioGalleryAPI = {
  list: listImageStudioGallery,
  save: saveImageStudioGallery,
  delete: deleteImageStudioGallery,
  quota: fetchStudioWorksQuota,
}

export default imageStudioGalleryAPI
