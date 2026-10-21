import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

interface PromptResizeOptions {
  minHeight?: number
  maxHeight?: number
  storageKey?: string
}

export function usePromptResize(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  options: PromptResizeOptions = {},
) {
  const minHeight = options.minHeight ?? 124
  const maxHeight = options.maxHeight ?? 576
  const height = ref(loadHeight())
  let stopResize: (() => void) | null = null

  function loadHeight() {
    const fallback = typeof window !== 'undefined' && window.innerWidth <= 480 ? '7.75rem' : '9rem'
    if (!options.storageKey || typeof window === 'undefined') return fallback
    const stored = Number(localStorage.getItem(options.storageKey))
    if (!Number.isFinite(stored) || stored <= 0) return fallback
    const max = Math.min(maxHeight, window.innerHeight * 0.65)
    return `${Math.round(Math.min(Math.max(stored, minHeight), max))}px`
  }

  function startResize(event: PointerEvent) {
    const textarea = textareaRef.value
    if (!textarea) return

    event.preventDefault()
    stopResize?.()

    const startY = event.clientY
    const startHeight = textarea.getBoundingClientRect().height
    const viewportLimit = Math.min(maxHeight, window.innerHeight * 0.65)

    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight + moveEvent.clientY - startY, minHeight),
        viewportLimit,
      )
      height.value = `${Math.round(next)}px`
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      stopResize = null
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    stopResize = cleanup
  }

  onBeforeUnmount(() => stopResize?.())

  watch(height, (value) => {
    if (!options.storageKey || typeof window === 'undefined') return
    const pixels = Number.parseFloat(value)
    if (Number.isFinite(pixels)) {
      localStorage.setItem(options.storageKey, String(Math.round(pixels)))
    }
  })

  return {
    height,
    startResize,
  }
}
