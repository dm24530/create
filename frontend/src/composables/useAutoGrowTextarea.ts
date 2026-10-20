import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

interface AutoGrowOptions {
  minHeight?: number | (() => number)
  maxHeight?: number | (() => number)
}

export function rootRemToPx(rem: number): number {
  if (typeof window === 'undefined') return rem * 16
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return (Number.isFinite(rootFontSize) ? rootFontSize : 16) * rem
}

/**
 * Grows a textarea with its content and caps the height before switching to
 * internal scrolling. The cap keeps the surrounding composer controls usable.
 */
export function useAutoGrowTextarea(value: Ref<string>, options: AutoGrowOptions = {}) {
  const textareaRef = ref<HTMLTextAreaElement | null>(null)
  const contentHeight = ref(0)
  const minHeight = options.minHeight ?? 0
  const maxHeight = options.maxHeight ?? 260

  function resize() {
    const element = textareaRef.value
    if (!element) return
    element.style.height = 'auto'
    contentHeight.value = element.scrollHeight
    const floor = typeof minHeight === 'function' ? minHeight() : minHeight
    const cap = typeof maxHeight === 'function' ? maxHeight() : maxHeight
    const nextHeight = Math.min(Math.max(element.scrollHeight, floor), cap)
    element.style.height = `${nextHeight}px`
    element.style.overflowY = element.scrollHeight > nextHeight ? 'auto' : 'hidden'
  }

  watch(value, () => {
    void nextTick(resize)
  })

  onMounted(() => {
    void nextTick(resize)
    window.addEventListener('resize', resize)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize)
  })

  return { textareaRef, resize, contentHeight }
}
