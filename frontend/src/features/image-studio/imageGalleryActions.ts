import type { Ref } from 'vue'
import { imageStudioGalleryAPI } from '@/api'
import type { GeneratedImage } from './imageStudioTypes'

export function galleryIdFor(
  image: GeneratedImage,
  localToGalleryId: ReadonlyMap<string, string>,
): string {
  const local = String(image.id)
  return String(image.galleryId || '') || localToGalleryId.get(local) || local
}

export function imageGallerySourceID(image: GeneratedImage): string {
  const taskId = String(image.gatewayTaskId || image.taskId || '').trim()
  return taskId
    ? `image-task:${taskId}:0`
    : String(image.gallerySourceId || '')
}

interface ImageGalleryActionOptions {
  images: Ref<GeneratedImage[]>
  previewImage: Ref<GeneratedImage | null>
  pendingDeleteImage: Ref<GeneratedImage | null>
  deletingImage: Ref<boolean>
  savingPreviewImage: Ref<boolean>
  errorMessage: Ref<string>
  galleryBackedIds: Ref<Set<string>>
  localToGalleryId: Ref<Map<string, string>>
  pendingGalleryImageIds: Map<string, Promise<string>>
  locallySavedGalleryIds: Set<string>
  studioQuota: Ref<{ used: number; limit: number } | null>
  imageModel: Ref<string>
  previewPromptDraft: Ref<string>
  isQuotaError: (error: unknown) => boolean
  formatError: (error: unknown, fallback: string) => string
  resolveImageAssetURL: (url: string) => string
  saveImageToGallery: (
    image: GeneratedImage,
    prompt: string,
    model: string,
    saved: boolean,
  ) => Promise<any>
  loadGallery: () => Promise<void>
  loadStudioQuota: () => Promise<void>
}

export function createImageGalleryActions(options: ImageGalleryActionOptions) {
  function idFor(image: GeneratedImage) {
    return galleryIdFor(image, options.localToGalleryId.value)
  }

  async function idForDownload(image: GeneratedImage) {
    const id = idFor(image)
    if (id && options.galleryBackedIds.value.has(id)) return id
    const pendingId = options.pendingGalleryImageIds.get(String(image.id))
    if (!pendingId) return id
    try {
      return await pendingId
    } catch {
      return id
    }
  }

  async function pinImage(image: GeneratedImage) {
    const id = idFor(image)
    if (!id || !options.galleryBackedIds.value.has(id)) return
    options.errorMessage.value = ''
    try {
      await imageStudioGalleryAPI.pin(id)
      image.saved = true
      image.expiresAt = 0
      await options.loadStudioQuota()
    } catch (error) {
      options.errorMessage.value = options.isQuotaError(error)
        ? `我的作品已满（${options.studioQuota.value?.limit || 100} 个），先删除一些再保存。`
        : options.formatError(error, '保存到我的作品失败')
    }
  }

  async function savePreviewToGallery() {
    const image = options.previewImage.value
    if (!image || image.saved || options.savingPreviewImage.value) return
    options.savingPreviewImage.value = true
    options.errorMessage.value = ''
    try {
      const id = idFor(image)
      if (id && options.galleryBackedIds.value.has(id)) {
        await imageStudioGalleryAPI.pin(id)
        image.saved = true
        image.expiresAt = 0
        await options.loadStudioQuota()
        return
      }

      const promptText = options.previewPromptDraft.value.trim() || image.prompt || ''
      const entry = await options.saveImageToGallery(
        image,
        promptText,
        image.model || options.imageModel.value,
        true,
      )
      options.locallySavedGalleryIds.add(String(entry.id))
      options.galleryBackedIds.value.add(String(entry.id))
      options.localToGalleryId.value.set(String(image.id), String(entry.id))
      image.galleryId = String(entry.id)
      image.gallerySourceId = entry.source_id || imageGallerySourceID(image)
      image.saved = entry.saved !== false
      image.expiresAt = entry.expires_at || 0
      image.prompt = promptText
      if (entry.url) image.src = options.resolveImageAssetURL(entry.url)
      image.thumbSrc = entry.thumb_url || ''
      await options.loadGallery()
      await options.loadStudioQuota()
    } catch (error) {
      options.errorMessage.value = options.isQuotaError(error)
        ? `我的作品已满（${options.studioQuota.value?.limit || 100} 个），先删除一些再保存。`
        : options.formatError(error, '保存到我的作品失败')
    } finally {
      options.savingPreviewImage.value = false
    }
  }

  function removeGalleryImage(image: GeneratedImage) {
    const id = idFor(image)
    if (!id || !options.galleryBackedIds.value.has(id)) return
    options.pendingDeleteImage.value = image
  }

  async function confirmRemoveGalleryImage() {
    const image = options.pendingDeleteImage.value
    options.pendingDeleteImage.value = null
    if (!image || options.deletingImage.value) return
    options.deletingImage.value = true
    options.errorMessage.value = ''
    try {
      const id = idFor(image)
      await imageStudioGalleryAPI.delete(id)
      options.galleryBackedIds.value.delete(id)
      options.locallySavedGalleryIds.delete(id)
      options.localToGalleryId.value.delete(String(image.id))
      options.images.value = options.images.value.filter(
        (item) => String(item.id) !== String(image.id),
      )
      await options.loadStudioQuota()
    } catch (error) {
      options.errorMessage.value = options.formatError(error, '删除失败')
    } finally {
      options.deletingImage.value = false
    }
  }

  return {
    galleryIdFor: idFor,
    imageGallerySourceID,
    galleryIdForDownload: idForDownload,
    pinImage,
    savePreviewToGallery,
    removeGalleryImage,
    confirmRemoveGalleryImage,
  }
}
