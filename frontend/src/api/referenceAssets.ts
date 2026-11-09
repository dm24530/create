import { apiClient, buildApiUrl } from '@/api/client'

export type ReferenceAssetKind = 'image' | 'video' | 'audio'

interface PresignReferenceAssetRequest {
  kind: ReferenceAssetKind
  content_type: string
  bytes: number
}

interface PresignReferenceAssetResult {
  object_key: string
  upload_url: string
  upload_headers: Record<string, string>
  content_type: string
}

interface CompleteReferenceAssetResult {
  url: string
}

export async function uploadReferenceAssetBlob(
  kind: ReferenceAssetKind,
  blob: Blob,
  contentType = blob.type,
): Promise<string> {
  if (!blob.size) throw new Error('参考素材为空')
  if (!contentType) throw new Error('参考素材缺少 MIME 类型')

  try {
    return await uploadReferenceAssetBlobDirect(kind, blob, contentType)
  } catch {
    return uploadReferenceAssetBlobMultipart(kind, blob, contentType)
  }
}

async function uploadReferenceAssetBlobDirect(
  kind: ReferenceAssetKind,
  blob: Blob,
  contentType: string,
): Promise<string> {
  const { data: presign } = await apiClient.post<PresignReferenceAssetResult>(
    '/video-studio/reference-assets/presign',
    {
      kind,
      content_type: contentType,
      bytes: blob.size,
    } satisfies PresignReferenceAssetRequest,
    { timeout: 30_000 },
  )

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1000)
  try {
    const response = await fetch(presign.upload_url, {
      method: 'PUT',
      headers: presign.upload_headers,
      body: blob,
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`参考素材直传失败（HTTP ${response.status}）`)
    }
  } finally {
    window.clearTimeout(timeout)
  }

  const { data: completed } = await apiClient.post<CompleteReferenceAssetResult>(
    '/video-studio/reference-assets/complete',
    {
      kind,
      content_type: presign.content_type || contentType,
      object_key: presign.object_key,
      bytes: blob.size,
    },
    { timeout: 60_000 },
  )
  if (!completed.url) throw new Error('参考素材完成后没有返回访问地址')
  return completed.url
}

async function uploadReferenceAssetBlobMultipart(
  kind: ReferenceAssetKind,
  blob: Blob,
  contentType: string,
): Promise<string> {
  const form = new FormData()
  form.append('kind', kind)
  form.append('file', blob, referenceFileName(kind, contentType))
  const token = localStorage.getItem('auth_token')
  const response = await fetch(buildApiUrl('/video-studio/reference-assets/upload'), {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || Number(payload?.code) !== 0) {
    throw new Error(payload?.message || `参考素材上传失败（HTTP ${response.status}）`)
  }
  const url = String(payload?.data?.url || '')
  if (!url) throw new Error('参考素材上传后没有返回访问地址')
  return url
}

function referenceFileName(kind: ReferenceAssetKind, contentType: string) {
  const extension = contentType === 'image/png'
    ? 'png'
    : contentType === 'image/webp'
      ? 'webp'
      : contentType === 'video/webm'
        ? 'webm'
        : kind === 'audio'
          ? 'audio'
          : kind === 'video'
            ? 'mp4'
            : 'jpg'
  return `reference-${Date.now()}.${extension}`
}

export async function uploadReferenceAssetDataURL(
  kind: ReferenceAssetKind,
  dataURL: string,
): Promise<string> {
  const blob = dataURLToBlob(dataURL)
  return uploadReferenceAssetBlob(kind, blob, blob.type)
}

export function dataURLToBlob(dataURL: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataURL)
  if (!match) throw new Error('参考素材 Data URL 无效')
  const contentType = match[1] || 'application/octet-stream'
  if (!match[2]) {
    return new Blob([decodeURIComponent(match[3])], { type: contentType })
  }
  const binary = atob(match[3])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: contentType })
}

export const referenceAssetsAPI = {
  uploadBlob: uploadReferenceAssetBlob,
  uploadDataURL: uploadReferenceAssetDataURL,
}
