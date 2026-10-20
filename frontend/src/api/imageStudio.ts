import { apiClient } from './client'

export interface ImageStudioGalleryEntry {
  id: string
  url: string
  prompt: string
  model: string
  size: string
  format: string
  /** true = 已存进「我的作品」（永久）；false = 生成页的临时内容（到期自动删）。 */
  saved: boolean
  created_at: number
  /** 临时内容的过期时间（秒）；已保存的为 0。 */
  expires_at: number
}

export interface SaveImageStudioGalleryRequest {
  image_data_url?: string
  image_url?: string
  prompt: string
  model: string
  size: string
  format: string
  /** 不传时后端按"直接存进我的作品"处理（老行为）；生成页应显式传 false。 */
  saved?: boolean
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

// 把临时内容存进「我的作品」：之后永久保留，并开始计入配额。
export async function pinImageStudioGallery(id: string): Promise<void> {
  await apiClient.post(`/image-studio/gallery/${encodeURIComponent(id)}/pin`)
}

export async function downloadImageStudioGallery(id: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(
    `/image-studio/gallery/${encodeURIComponent(id)}/download`,
    { responseType: 'blob', timeout: 2 * 60 * 1000 },
  )
  return data
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
  pin: pinImageStudioGallery,
  download: downloadImageStudioGallery,
  quota: fetchStudioWorksQuota,
}

export default imageStudioGalleryAPI
