import { readonly, ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

const isDark = ref(true)
let initialized = false

function applyTheme(mode: ThemeMode) {
  isDark.value = mode === 'dark'
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', isDark.value)
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('theme', mode)
  }
}

function initializeTheme() {
  if (initialized || typeof window === 'undefined') return
  const savedTheme = localStorage.getItem('theme')
  applyTheme(savedTheme === 'light' ? 'light' : 'dark')
  initialized = true
}

export function useTheme() {
  initializeTheme()

  function setTheme(mode: ThemeMode) {
    applyTheme(mode)
  }

  function toggleTheme() {
    setTheme(isDark.value ? 'light' : 'dark')
  }

  return {
    isDark: readonly(isDark),
    setTheme,
    toggleTheme,
  }
}
