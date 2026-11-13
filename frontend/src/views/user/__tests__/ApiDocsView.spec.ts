import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ApiDocsView from '../ApiDocsView.vue'

const viewSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../ApiDocsView.vue'),
  'utf8',
)

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    cachedPublicSettings: { api_base_url: 'https://api.example.com/v1' },
    apiBaseUrl: 'https://api.example.com/v1',
    siteName: 'Create',
  }),
}))

const stubs = {
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  Icon: true,
  ManualQuickModal: {
    props: ['show'],
    template: '<div data-testid="manual-modal" :data-show="String(show)" />',
  },
  DocCodeBlock: {
    props: ['code', 'title', 'language'],
    template: '<pre data-testid="doc-code">{{ code }}</pre>',
  },
}

describe('ApiDocsView', () => {
  it('renders as a standalone docs page without the workspace layout', () => {
    expect(viewSource).not.toContain("import AppLayout from '@/components/layout/AppLayout.vue'")
    expect(viewSource).not.toContain('<AppLayout>')

    const wrapper = mount(ApiDocsView, { global: { stubs } })
    expect(wrapper.get('.docs-topbar').text()).toContain('接口文档')
    expect(wrapper.get('.docs-topbar').text()).toContain('返回工作台')
  })

  it('renders the complete API reference with configured base URL and examples', () => {
    const wrapper = mount(ApiDocsView, { global: { stubs } })

    expect(wrapper.get('#overview h2').text()).toBe('接口概览')
    expect(wrapper.get('#authentication h2').text()).toBe('认证与请求头')
    expect(wrapper.get('#images h2').text()).toBe('文本生成图片')
    expect(wrapper.get('#image-edits h2').text()).toBe('参考图编辑')
    expect(wrapper.get('#videos h2').text()).toBe('创建视频任务')
    expect(wrapper.get('#video-tasks h2').text()).toBe('轮询与下载视频')
    expect(wrapper.get('#errors h2').text()).toBe('错误码与排查')
    expect(wrapper.text()).toContain('https://api.example.com/v1/images/generations')
    expect(wrapper.text()).toContain('Authorization: Bearer $CREATE_API_KEY')
    expect(wrapper.text()).not.toContain('Chat Completions')
    expect(wrapper.text()).not.toContain('/chat/completions')
    expect(wrapper.text()).not.toContain('/responses')
    expect(wrapper.text()).not.toContain('/messages')
    expect(wrapper.text()).not.toContain('/embeddings')
    expect(wrapper.text()).toContain('响应同时包含 URL 和 inlineData 时优先 URL')
    expect(wrapper.text()).toContain('response_format=url 不保证让 Google 强制返回 URL')
    expect(wrapper.text()).toContain('Idempotency-Key')
    expect(wrapper.text()).toContain('/images/tasks/:task_id/content')
    expect(wrapper.text()).toContain('/v1beta/models/{model}:generateContent')
    expect(wrapper.findAll('[data-testid="doc-code"]').length).toBeGreaterThan(8)
  })

  it('opens the current studio manual instead of navigating to the retired page', async () => {
    const wrapper = mount(ApiDocsView, { global: { stubs } })

    expect(wrapper.find('a[href="/manual"]').exists()).toBe(false)
    expect(wrapper.getComponent(stubs.ManualQuickModal).props('show')).toBe(false)

    await wrapper.get('.docs-sidebar__manual-link').trigger('click')

    expect(wrapper.getComponent(stubs.ManualQuickModal).props('show')).toBe(true)
  })
})
