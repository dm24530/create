import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import CanvasHostView from '../CanvasHostView.vue'
import { useAuthStore } from '@/stores/auth'
import { notifyCreatorKeyChanged } from '@/utils/creatorKeyEvents'

const { getPublicSettings, listKeys } = vi.hoisted(() => ({
  getPublicSettings: vi.fn(),
  listKeys: vi.fn(),
}))

vi.mock('@/api', () => ({
  authAPI: { getPublicSettings },
  keysAPI: { list: listKeys },
}))

vi.mock('@/composables/useTheme', () => ({
  useTheme: () => ({ isDark: ref(true) }),
}))

vi.mock('@/utils/apiEndpoint', () => ({
  resolvePlaygroundApiEndpoint: () => 'https://api.example.com',
}))

const keys = [
  {
    id: 1,
    name: 'Key one',
    key: 'sk-user-101',
    status: 'active',
    group: { allow_image_generation: true },
  },
  {
    id: 2,
    name: 'Key two',
    key: 'sk-user-102',
    status: 'active',
    group: { allow_image_generation: true },
  },
  {
    id: 3,
    name: 'Video key',
    key: 'sk-video-103',
    status: 'active',
    group: { allow_image_generation: false, video_capable: true },
  },
]

const postMessage = vi.fn()

function mountHost(options: { role?: 'user' | 'admin' } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const authStore = useAuthStore(pinia)
  authStore.user = {
    id: 101,
    email: options.role === 'admin' ? 'admin@example.com' : 'first@example.com',
    role: options.role || 'user',
  } as any
  authStore.token = 'token-user-101'
  return mount(CanvasHostView, {
    global: {
      plugins: [
        pinia,
        createI18n({
          legacy: false,
          locale: 'zh-CN',
          messages: { 'zh-CN': {}, 'en-US': {} },
        }),
      ],
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('CanvasHostView account switching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    getPublicSettings.mockReset()
    listKeys.mockReset()
    getPublicSettings.mockResolvedValue({ api_base_url: 'https://api.example.com' })
    listKeys.mockResolvedValue({ items: keys })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response))
    postMessage.mockReset()
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get: () => ({ postMessage }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reloads bootstrap credentials before sending them to the next user iframe', async () => {
    localStorage.setItem('sub2api:image-studio:preferences:101', JSON.stringify({ keyId: '1' }))
    localStorage.setItem('sub2api:image-studio:preferences:102', JSON.stringify({ keyId: '2' }))
    localStorage.setItem('sub2api:video-studio:preferences:101', JSON.stringify({ keyId: '3' }))
    localStorage.setItem('sub2api:video-studio:preferences:102', JSON.stringify({ keyId: '3' }))

    const wrapper = mountHost()
    await flushPromises()
    await flushPromises()

    const iframe = wrapper.get('iframe')
    await iframe.trigger('load')
    await vi.advanceTimersByTimeAsync(0)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-user-101',
        videoApiKey: 'sk-video-103',
        accessToken: 'token-user-101',
      }),
      expect.any(String),
    )
    postMessage.mockClear()

    const authStore = useAuthStore()
    authStore.user = { id: 102, email: 'second@example.com', role: 'user' } as any
    authStore.token = 'token-user-102'
    await flushPromises()
    await flushPromises()

    await wrapper.get('iframe').trigger('load')
    await vi.advanceTimersByTimeAsync(0)

    const payloads = postMessage.mock.calls.map(([payload]) => payload as Record<string, unknown>)
    expect(payloads).toContainEqual(expect.objectContaining({
      apiKey: 'sk-user-102',
      videoApiKey: 'sk-video-103',
      accessToken: 'token-user-102',
    }))
    expect(payloads).not.toContainEqual(expect.objectContaining({
      apiKey: 'sk-user-101',
    }))
    expect(listKeys).toHaveBeenCalledTimes(2)
  })

  it('loads the embedded canvas from the current origin in development', async () => {
    const wrapper = mountHost()
    await flushPromises()

    const src = wrapper.get('iframe').attributes('src') || ''
    expect(src).toContain('/canvas-app/canvas?embed=1')
    expect(src).not.toContain('localhost:3001')
  })

  it('reloads canvas credentials when the image studio changes its API key', async () => {
    const wrapper = mountHost()
    await flushPromises()
    await flushPromises()
    await wrapper.get('iframe').trigger('load')
    await vi.advanceTimersByTimeAsync(0)
    postMessage.mockClear()

    listKeys.mockResolvedValue({
      items: [
        ...keys,
        {
          id: 4,
          name: 'New image key',
          key: 'sk-user-104',
          status: 'active',
          group: { allow_image_generation: true },
        },
      ],
    })
    localStorage.setItem('sub2api:image-studio:preferences:101', JSON.stringify({ keyId: '4' }))
    notifyCreatorKeyChanged('image', '4')
    await flushPromises()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-user-104',
        channelName: 'New image key',
      }),
      expect.any(String),
    )
  })

  it('opens the canvas library for an admin without a generation key', async () => {
    listKeys.mockResolvedValue({ items: [] })

    const wrapper = mountHost({ role: 'admin' })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('请先在生图工作台选择一个可用的 API Key')
  })

  it('retries a transient canvas context network failure', async () => {
    getPublicSettings
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ api_base_url: 'https://api.example.com' })

    const wrapper = mountHost()
    await flushPromises()
    expect(wrapper.text()).not.toContain('后端正在重启')

    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('画布加载失败')
  })

  it('shows an actionable message when the canvas origin stays unavailable', async () => {
    getPublicSettings.mockRejectedValue(new TypeError('Failed to fetch'))
    listKeys.mockRejectedValue(new TypeError('Failed to fetch'))

    const wrapper = mountHost()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    expect(wrapper.text()).toContain('画布加载失败')
    expect(wrapper.text()).toContain('源站返回 502')
    expect(wrapper.find('iframe').exists()).toBe(true)
  })
})
