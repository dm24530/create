import { buildApiUrl } from '@/api/client'

export type ReferenceAssetKind = 'image' | 'video' | 'audio'

export async function uploadReferenceAssetBlob(
  kind: ReferenceAssetKind,
  blob: Blob,
  contentType = blob.type,
): Promise<string> {
  if (!blob.size) throw new Error('参考素材为空')
  if (!contentType) throw new Error('参考素材缺少 MIME 类型')
  return uploadReferenceAssetBlobMultipart(kind, blob, contentType)
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
  return new URL(buildApiUrl(url), window.location.origin).toString()
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
