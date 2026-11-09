import type { Ref } from 'vue'
import { imageStudioGalleryAPI } from '@/api'
import type { GeneratedImage } from './imageStudioTypes'
import { imageDownloadURL, resolveImageAssetURL } from './imageDownload'

export function imageDownloadFilename(image: GeneratedImage) {
  return `${image.title}.${image.format || 'png'}`
}

export function imageDownloadMenuPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const width = 208
  const height = 78
  return {
    x: Math.max(8, Math.min(clientX, viewportWidth - width - 8)),
    y: Math.max(8, Math.min(clientY, viewportHeight - height - 8)),
  }
}

interface ImageStudioDownloadOptions {
  downloadingImageIds: Ref<Set<string>>
  galleryBackedIds: Ref<Set<string>>
  imageDownloadMenu: Ref<{ x: number; y: number; image: GeneratedImage } | null>
  galleryIdForDownload: (image: GeneratedImage) => Promise<string>
  fetchGatewayTaskOriginalBlob: (image: GeneratedImage, index: number) => Promise<Blob>
  reportError: (message: string) => void
  showError: (message: string, timeout?: number) => void
}

export function createImageStudioDownloads(options: ImageStudioDownloadOptions) {
  function saveBlob(blob: Blob, filename: string) {
    const objectUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.click()
    window.setTimeout(() => window.URL.revokeObjectURL?.(objectUrl), 1000)
  }

  async function downloadImage(image: GeneratedImage) {
    const mediaId = String(image.id)
    if (options.downloadingImageIds.value.has(mediaId)) return
    options.downloadingImageIds.value.add(mediaId)
    const filename = imageDownloadFilename(image)
    try {
      const id = await options.galleryIdForDownload(image)
      if (id && options.galleryBackedIds.value.has(id)) {
        try {
          const direct = await imageStudioGalleryAPI.downloadURL(id)
          const link = document.createElement('a')
          link.href = direct.url
          link.download = direct.filename || filename
          document.body.appendChild(link)
          link.click()
          link.remove()
          return
        } catch (error) {
          console.warn('Signed image download URL failed; falling back to direct fetch', error)
        }
      }
      if (String(image.gatewayTaskId || '').trim()) {
        try {
          const blob = await options.fetchGatewayTaskOriginalBlob(image, 0)
          saveBlob(blob, filename)
          return
        } catch (error) {
          console.warn('Gateway task original download failed; falling back to gallery stream', error)
        }
      }
      const source = resolveImageAssetURL(image.originalSrc || image.src)
      if (!image.gatewayTaskId) try {
        const response = await fetch(source, {
          credentials: 'omit',
          cache: 'force-cache',
          signal: AbortSignal.timeout(2 * 60 * 1000),
        })
        if (!response.ok) throw new Error(`download failed: ${response.status}`)
        saveBlob(await response.blob(), filename)
        return
      } catch (error) {
        console.warn('Direct image download failed; falling back to backend stream', error)
      }
      if (id && options.galleryBackedIds.value.has(id)) {
        try {
          const blob = await imageStudioGalleryAPI.download(id)
          saveBlob(blob, filename)
          return
        } catch (error) {
          console.warn('Backend image download failed', error)
        }
      }
      if (image.gatewayTaskId) {
        throw new Error('原图下载失败，请稍后重试')
      }
      const link = document.createElement('a')
      link.href = imageDownloadURL(image.originalSrc || image.src)
      link.download = filename
      link.click()
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载图片失败'
      options.reportError(message)
      options.showError(message, 5000)
    } finally {
      options.downloadingImageIds.value.delete(mediaId)
    }
  }

  function openImageDownloadMenu(event: MouseEvent, image: GeneratedImage) {
    if (image.pending || image.failed) return
    const position = imageDownloadMenuPosition(
      event.clientX,
      event.clientY,
      window.innerWidth,
      window.innerHeight,
    )
    options.imageDownloadMenu.value = {
      ...position,
      image,
    }
  }

  function closeImageDownloadMenu() {
    options.imageDownloadMenu.value = null
  }

  function downloadOriginalFromMenu() {
    const image = options.imageDownloadMenu.value?.image
    closeImageDownloadMenu()
    if (image) void downloadImage(image)
  }

  function isImageDownloading(image: GeneratedImage) {
    return options.downloadingImageIds.value.has(String(image.id))
  }

  return {
    downloadImage,
    openImageDownloadMenu,
    closeImageDownloadMenu,
    downloadOriginalFromMenu,
    isImageDownloading,
    saveBlob,
  }
}
