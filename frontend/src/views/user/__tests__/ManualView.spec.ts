import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import ManualView from '../ManualView.vue'

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

describe('ManualView', () => {
  it('focuses the manual on image and video creation workflows', () => {
    const wrapper = mount(ManualView, { global: { stubs } })

    expect(wrapper.get('h1').text()).toBe('图片与视频创作手册')
    expect(wrapper.get('#image h2').text()).toBe('使用图片工作台')
    expect(wrapper.get('#video h2').text()).toBe('使用视频工作台')
    expect(wrapper.get('#api h2').text()).toBe('通过 API 生成图片和视频')
    expect(wrapper.text()).toContain('https://api.example.com/v1/images/generations')
    expect(wrapper.text()).toContain('https://api.example.com/v1/contents/generations/tasks')
    expect(wrapper.text()).not.toContain('ChatBox')
    expect(wrapper.text()).not.toContain('Cherry Studio')
    expect(wrapper.text()).not.toContain('Cursor')
    expect(wrapper.findAll('[data-testid="doc-code"]')).toHaveLength(4)
  })
})
