import { describe, expect, it, vi } from 'vitest'

import { resolveRouteSeo } from '../seo'

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (key: string) => key === 'home.seoDescription'
        ? 'Create 是一个 AI 视频与图片生成平台'
        : key,
    },
  },
}))

describe('resolveRouteSeo', () => {
  it('adds indexed search metadata to public routes', () => {
    const seo = resolveRouteSeo({
      path: '/home',
      meta: {
        requiresAuth: false,
        descriptionKey: 'home.seoDescription',
        seoKeywords: ['Create', 'GPT', 'OpenAI', 'Claude', 'DeepSeek'],
      },
    }, 'Create - AI 视频与图片生成', 'https://superai.sbs', 'Create', 'libTV,CreateAI')

    expect(seo.description).toContain('Create')
    expect(seo.description).toContain('视频')
    expect(seo.keywords).toContain('GPT')
    expect(seo.keywords).toContain('libTV')
    expect(seo.keywords).toContain('CreateAI')
    expect(seo.siteName).toBe('Create')
    expect(seo.canonical).toBe('https://superai.sbs/home')
    expect(seo.robots).toBe('index,follow')
  })

  it('keeps authenticated routes out of search indexes', () => {
    const seo = resolveRouteSeo({
      path: '/admin/settings',
      meta: {
        requiresAuth: true,
        requiresAdmin: true,
      },
    }, 'System Settings - Create', 'https://superai.sbs')

    expect(seo.robots).toBe('noindex,nofollow')
  })

  it('uses the home page as the canonical entry for the root route', () => {
    const seo = resolveRouteSeo({
      path: '/',
      meta: { requiresAuth: false },
    }, 'Create - AI 视频与图片生成', 'https://example.com', 'Create', 'libTV')

    expect(seo.canonical).toBe('https://example.com/home')
  })
})
