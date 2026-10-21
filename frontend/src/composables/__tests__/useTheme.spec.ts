import { describe, expect, it } from 'vitest'

import { useTheme } from '../useTheme'

describe('useTheme', () => {
  it('updates the document class and persisted preference', () => {
    const { isDark, setTheme, toggleTheme } = useTheme()

    setTheme('dark')
    expect(isDark.value).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')

    toggleTheme()
    expect(isDark.value).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
