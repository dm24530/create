export const IMAGE_STUDIO_GALLERY_CHANGED_EVENT = 'image-studio-gallery-changed'

export function notifyImageStudioGalleryChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(IMAGE_STUDIO_GALLERY_CHANGED_EVENT))
}
