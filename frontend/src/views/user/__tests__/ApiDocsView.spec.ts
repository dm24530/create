import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import ApiDocsView from '../ApiDocsView.vue'

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    cachedPublicSettings: { api_base_url: 'https://api.example.com/v1' },
    apiBaseUrl: 'https://api.example.com/v1',
  }),
}))

const stubs = {
  AppLayout: { template: '<div><slot /></div>' },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  Icon: true,
  DocCodeBlock: {
    props: ['code', 'title', 'language'],
    template: '<pre data-testid="doc-code">{{ code }}</pre>',
  },
}

describe('ApiDocsView', () => {
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
    expect(wrapper.findAll('[data-testid="doc-code"]').length).toBeGreaterThan(8)
  })
})
