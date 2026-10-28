import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VideoStudioView from '../VideoStudioView.vue'
import { saveVideoWork } from '../videoWorks'
import { resetVideoStudioDraft } from '../videoStudioDraft'
import { useAppStore } from '@/stores/app'

const { listKeys, getPublicSettings, copyToClipboard, routeQuery } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  getPublicSettings: vi.fn(),
  copyToClipboard: vi.fn(),
  routeQuery: { value: {} as Record<string, string> },
}))

const {
  archiveVideo,
  deleteArchivedVideo,
  listArchivedVideos,
} = vi.hoisted(() => ({
  archiveVideo: vi.fn(),
  deleteArchivedVideo: vi.fn(),
  listArchivedVideos: vi.fn(),
}))

vi.mock('../videoArchiveApi', () => ({
  archiveVideo,
  listArchivedVideos,
  deleteArchivedVideo,
  fetchStudioWorksQuota: vi.fn().mockResolvedValue({ used: 0, limit: 100 }),
  isStudioQuotaError: () => false,
  fetchOnlineInspirationsFromServer: vi.fn().mockResolvedValue([]),
  fetchOnlineInspirationFeed: vi.fn().mockResolvedValue({ items: [] }),
  inspirationMediaProxyUrl: (rawUrl: string) => `/proxied?u=${encodeURIComponent(rawUrl)}`,
}))

vi.mock('@/api', () => ({
  keysAPI: { list: listKeys },
  authAPI: { getPublicSettings },
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard }),
}))

vi.mock('@/composables/useCreatorKey', () => ({
  isCreationServiceUnavailable: (error: unknown) =>
    String((error as { message?: unknown } | null)?.message ?? error ?? '')
      .includes('NO_VIDEO_CREATION_SERVICE'),
  ensureCreatorKey: async () => {
    const result = await listKeys()
    return { keys: result.items, key: result.items[0] }
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery.value }),
}))

function mountStudio() {
  return mount(VideoStudioView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        BaseDialog: {
          props: ['show', 'title', 'closeOnClickOutside'],
          emits: ['close'],
          template:
            '<div v-if="show"><button v-if="closeOnClickOutside" data-testid="dialog-backdrop" @click="$emit(\'close\')">backdrop</button><h3>{{ title }}</h3><slot /><slot name="footer" /></div>',
        },
        Icon: { template: '<span />' },
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        ImageStudioSelect: {
          props: ['modelValue', 'options', 'placeholder', 'disabled'],
          emits: ['update:modelValue'],
          template:
            '<div><span>{{ options.find(o => o.value === modelValue)?.label || placeholder }}</span>' +
            '<button v-for="o in options" :key="o.value" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</button></div>',
        },
      },
    },
  })
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
  } as unknown as Response
}

function resetMocks() {
  resetVideoStudioDraft()
  listKeys.mockReset()
  getPublicSettings.mockReset()
  copyToClipboard.mockReset()
  archiveVideo.mockReset()
  deleteArchivedVideo.mockReset()
  listArchivedVideos.mockReset()
  listArchivedVideos.mockResolvedValue([])
  // 默认按"对象存储没配"处理：归档失败只提示，不影响生成结果本身。
  archiveVideo.mockRejectedValue({ reason: 'IMAGE_STORAGE_DISABLED', message: 'image storage is not enabled' })
  routeQuery.value = {}
  listKeys.mockResolvedValue({
    items: [{ id: 7, name: 'video-key', key: 'sk-video', status: 'active', group_id: 1 }],
  })
  getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
  copyToClipboard.mockResolvedValue(true)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('VideoStudioView model loading', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('only lists video-capable models from the key model list', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({
          data: [
            { id: 'gpt-image-1' },
            { id: 'wanx2.1-t2i-turbo' },
            { id: 'seedance-2-720p' },
            { id: 'grok-imagine-video' },
            { id: 'gpt-5' },
          ],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    const modelSelect = wrapper.get('[data-testid="video-model-select"]')
    expect(modelSelect.text()).toContain('seedance-2-720p')
    expect(modelSelect.text()).toContain('grok-imagine-video')
    expect(modelSelect.text()).not.toContain('gpt-image-1')
    expect(modelSelect.text()).not.toContain('wanx2.1-t2i-turbo')
    expect(modelSelect.text()).not.toContain('gpt-5')
  })

  it('accepts a composite key without per-resolution video pricing', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 8,
        name: '创作密钥',
        key: 'sk-composite',
        status: 'active',
        group_id: 3,
        group: { platform: 'composite', video_price_480p: null },
      }],
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'grok-imagine-video' }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.get('[data-testid="video-model-select"]').text()).toContain('grok-imagine-video')
    expect(fetchMock).toHaveBeenCalledWith('/v1/models', {
      headers: { Authorization: 'Bearer sk-composite' },
    })
  })

  it('keeps the selected API key across page refresh and manual key refresh', async () => {
    localStorage.setItem(
      'sub2api:video-studio:preferences',
      JSON.stringify({ keyId: '8' }),
    )
    listKeys.mockResolvedValue({
      items: [
        {
          id: 7,
          name: 'video-key-default',
          key: 'sk-default',
          status: 'active',
          group_id: 1,
          group: { platform: 'openai', video_capable: true },
        },
        {
          id: 8,
          name: 'video-key-selected',
          key: 'sk-selected',
          status: 'active',
          group_id: 4,
          group: { platform: 'openai', video_capable: true },
        },
      ],
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'seedance-2-720p' }] }))

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    const modelCalls = () =>
      fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/models'))
    const allUseSelectedKey = () => modelCalls().every((call) => {
      const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined
      return headers?.Authorization === 'Bearer sk-selected'
    })
    expect(allUseSelectedKey()).toBe(true)

    await wrapper.get('[data-testid="video-refresh"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(modelCalls().length).toBeGreaterThan(0)
    expect(allUseSelectedKey()).toBe(true)
  })

  it('loads models when settings resolve before the saved API key', async () => {
    localStorage.setItem(
      'sub2api:video-studio:preferences',
      JSON.stringify({ keyId: '8' }),
    )
    let resolveKeys: ((value: { items: unknown[] }) => void) | undefined
    listKeys.mockImplementation(() => new Promise((resolve) => {
      resolveKeys = resolve
    }))
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'seedance-2-720p' }] }))

    const wrapper = mountStudio()
    await flushPromises()
    resolveKeys?.({
      items: [{
        id: 8,
        name: 'video-key-selected',
        key: 'sk-selected',
        status: 'active',
        group_id: 4,
        group: { platform: 'openai', video_capable: true },
      }],
    })
    await flushPromises()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/v1/models', {
      headers: { Authorization: 'Bearer sk-selected' },
    })
    expect(wrapper.get('[data-testid="video-model-select"]').text()).toContain('seedance-2-720p')
  })

  it('loads archived videos into the results grid with playback controls', async () => {
    listArchivedVideos.mockResolvedValue([{
      id: 'archived-result-1',
      url: 'https://cdn.example.com/archived-result.mp4',
      prompt: '已归档的测试视频',
      model: 'seedance-2-720p',
      format: 'mp4',
      duration_seconds: 5,
      saved: false,
      created_at: 1_700_000_000,
      expires_at: 1_800_000_000,
    }])
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect(listArchivedVideos).toHaveBeenCalledWith('temp')
    expect(wrapper.text()).toContain('已归档的测试视频')
    const video = wrapper.get('[data-testid="video-result-player"]')
    expect(video.attributes('src')).toBe('https://cdn.example.com/archived-result.mp4')
    expect(video.attributes('controls')).toBeDefined()
  })

  it('does not expose raw no-service errors in the composer', async () => {
    listKeys.mockRejectedValue(new Error('NO_VIDEO_CREATION_SERVICE'))
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).not.toContain('NO_VIDEO_CREATION_SERVICE')
    expect(wrapper.text()).not.toContain('视频创作服务暂不可用')
  })
})

describe('VideoStudioView seedance generation', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('submits the Ark task payload and plays the finished video', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      }
      if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        return jsonResponse({ id: 'task-1' })
      }
      if (url.endsWith('/contents/generations/tasks/task-1')) {
        return jsonResponse({
          id: 'task-1',
          status: 'succeeded',
          content: { video_url: 'https://cdn.example.com/out.mp4' },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await wrapper.get('textarea').setValue('镜头缓慢推进，海雾从左侧涌入')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).endsWith('/contents/generations/tasks') && call[1]?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    const payload = JSON.parse(String(createCall?.[1]?.body))
    expect(payload.model).toBe('seedance-2-720p')
    expect(payload.content[0]).toEqual({ type: 'text', text: '镜头缓慢推进，海雾从左侧涌入' })
    expect(payload.duration).toBe(5)
    expect(payload.resolution).toBe('720p')
    expect(payload.ratio).toBe('16:9')

    const video = wrapper.get('video')
    expect(video.attributes('src')).toBe('https://cdn.example.com/out.mp4')
  })

  it('submits the selected number of independent video tasks', async () => {
    let createCount = 0
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      }
      if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        createCount += 1
        return jsonResponse({ id: `task-${createCount}` })
      }
      const task = url.match(/\/contents\/generations\/tasks\/(task-\d+)$/)?.[1]
      if (task) {
        return jsonResponse({
          id: task,
          status: 'succeeded',
          content: { video_url: `https://cdn.example.com/${task}.mp4` },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await wrapper.get('textarea').setValue('镜头缓慢推进，海雾从左侧涌入')
    await wrapper.get('[data-testid="video-task-count"]').setValue('3')
    await wrapper.get('[data-testid="video-task-count"]').trigger('blur')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(createCount).toBe(3)
    expect(wrapper.findAll('video')).toHaveLength(3)
  })

  it('keeps the duration parameter inside the range the upstream accepts', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    const durationInput = wrapper.get('[data-testid="video-duration-control"] input')
    await durationInput.setValue('99')
    await durationInput.trigger('blur')

    expect((durationInput.element as HTMLInputElement).value).toBe('15')
  })

  it('does not offer one-second or two-second duration presets', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    const buttons = wrapper.findAll('[data-testid="video-duration-control"] button')
      .map((button) => button.text())
    expect(buttons).not.toContain('1秒')
    expect(buttons).not.toContain('2秒')
  })

  // 查看类弹窗点外面关掉，带输入的表单弹窗不能：误点会丢掉刚填的链接/类型。
  it('keeps the reference-material dialog open when clicking outside', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()

    await wrapper.get('[data-testid="video-reference-trigger"]').trigger('click')
    expect(wrapper.text()).toContain('添加参考素材')
    expect(wrapper.find('[data-testid="dialog-backdrop"]').exists()).toBe(false)
  })

  it('archives a finished video and switches the card to the stored copy', async () => {
    archiveVideo.mockResolvedValue({
      id: 'arch-1',
      url: 'https://cdn.example.com/archived.mp4',
      prompt: '',
      model: '',
      format: 'mp4',
      duration_seconds: 5,
      created_at: 1,
      expires_at: 2,
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        return jsonResponse({ id: 'task-9' })
      }
      if (url.endsWith('/contents/generations/tasks/task-9')) {
        return jsonResponse({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/out.mp4' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await wrapper.get('textarea').setValue('一段会被归档的镜头')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    // 公开直链交给服务端抓取归档，浏览器不用下载再上传。
    expect(archiveVideo).toHaveBeenCalledWith(
      expect.objectContaining({ video_url: 'https://cdn.example.com/out.mp4', model: 'seedance-2-720p' }),
    )
    await vi.waitFor(() => {
      expect(wrapper.get('video').attributes('src')).toBe('https://cdn.example.com/archived.mp4')
    })
  })
})

describe('VideoStudioView Seedance model controls', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:seedance-video'), revokeObjectURL: vi.fn() })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('submits model-specific duration, resolution and reference fields through the video endpoint', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2.5' }] })
      if (url.endsWith('/video/generations') && init?.method === 'POST') {
        return jsonResponse({ id: 'task-seedance', task_id: 'task-seedance', status: 'queued' })
      }
      if (url.endsWith('/videos/task-seedance')) {
        return jsonResponse({
          id: 'task-seedance',
          status: 'completed',
          duration: 30,
          metadata: { url: '/v1/videos/task-seedance/content' },
        })
      }
      if (url.endsWith('/videos/task-seedance/content')) {
        return { ok: true, status: 200, statusText: 'OK', blob: async () => new Blob(['video']) } as unknown as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.get('[data-testid="video-resolution-control"]').attributes('style'))
      .toContain('--video-segment-count: 3')
    expect(wrapper.get('[data-testid="video-duration-control"] .video-composer__segmented').attributes('style'))
      .toContain('--video-segment-count: 5')

    await wrapper.get('textarea').setValue('雨夜车窗外的霓虹缓慢后退')
    const durationInput = wrapper.get('[data-testid="video-duration-control"] input')
    await durationInput.setValue('30')
    await durationInput.trigger('blur')
    await wrapper.findAll('[data-testid="video-resolution-control"] button')
      .find((button) => button.text() === '1080P')!
      .trigger('click')

    await wrapper.get('[data-testid="video-reference-trigger"]').trigger('click')
    await wrapper.get('[data-testid="reference-url-input"]').setValue('https://cdn.example.com/frame.png')
    const addButton = wrapper.findAll('button').find((button) => button.text() === '添加')
    await addButton!.trigger('click')
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).endsWith('/video/generations') && call[1]?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    const payload = JSON.parse(String(createCall?.[1]?.body))
    expect(payload).toMatchObject({
      model: 'seedance-2.5',
      mode: 'image-to-video',
      duration: 30,
      resolution: '1080p',
      aspect_ratio: '16:9',
      images: ['https://cdn.example.com/frame.png'],
    })
    expect(payload.prompt).toBe('雨夜车窗外的霓虹缓慢后退')
    expect(wrapper.get('video').attributes('src')).toBe('blob:seedance-video')
    expect(wrapper.get('[data-testid="video-model-select"]').text()).toContain('seedance-2.5')
    expect((wrapper.get('[data-testid="video-duration-control"] input').element as HTMLInputElement).value).toBe('30')
    expect(wrapper.findAll('[data-testid="video-resolution-control"] button')
      .find((button) => button.classes('is-active'))?.text()).toBe('1080P')
  })

  it('archives authenticated Momo video bytes instead of asking the server to refetch', async () => {
    archiveVideo.mockResolvedValue({
      id: 'arch-seedance',
      url: 'https://r2.example.com/seedance.mp4',
      prompt: '',
      model: 'seedance-2.5',
      format: 'mp4',
      duration_seconds: 5,
      created_at: 1,
      expires_at: 2,
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2.5' }] })
      if (url.endsWith('/video/generations') && init?.method === 'POST') {
        return jsonResponse({ id: 'task-momo-archive', task_id: 'task-momo-archive', status: 'queued' })
      }
      if (url.endsWith('/videos/task-momo-archive')) {
        return jsonResponse({
          id: 'task-momo-archive',
          status: 'completed',
          metadata: { url: '/v1/videos/task-momo-archive/content' },
        })
      }
      if (url.endsWith('/videos/task-momo-archive/content')) {
        return { ok: true, status: 200, statusText: 'OK', blob: async () => new Blob(['video']) } as unknown as Response
      }
      if (url === 'blob:seedance-video') {
        return { ok: true, blob: async () => new Blob(['video']) } as unknown as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('textarea').setValue('归档这条 Momo 视频')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    await vi.waitFor(() => {
      expect(archiveVideo).toHaveBeenCalledWith(expect.objectContaining({
        video_data_url: expect.stringContaining('data:'),
      }))
    })
    expect(archiveVideo).not.toHaveBeenCalledWith(expect.objectContaining({
      video_url: '/v1/videos/task-momo-archive/content',
    }))
  })

  it('recovers and archives a succeeded Momo task when its saved blob URL expired after refresh', async () => {
    saveVideoWork({
      id: 'vw-refresh-momo',
      provider: 'seedance_video',
      requestId: 'task-refresh-momo',
      keyId: 7,
      model: 'seedance-2.5',
      prompt: '刷新后继续取回',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
      referenceCounts: { images: 0, videos: 0, audios: 0 },
      videoUrl: 'blob:expired-after-refresh',
      createdAt: Date.now(),
      status: 'succeeded',
      statusMessage: '',
    })
    archiveVideo.mockResolvedValue({
      id: 'arch-refresh',
      url: 'https://r2.example.com/refreshed.mp4',
      prompt: '',
      model: 'seedance-2.5',
      format: 'mp4',
      duration_seconds: 5,
      created_at: 1,
      expires_at: 2,
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2.5' }] })
      if (url.endsWith('/videos/task-refresh-momo')) {
        return jsonResponse({
          id: 'task-refresh-momo',
          status: 'completed',
          metadata: { url: '/v1/videos/task-refresh-momo/content' },
        })
      }
      if (url.endsWith('/videos/task-refresh-momo/content')) {
        return { ok: true, status: 200, statusText: 'OK', blob: async () => new Blob(['video']) } as unknown as Response
      }
      if (url === 'blob:seedance-video') {
        return { ok: true, blob: async () => new Blob(['video']) } as unknown as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()
    await flushPromises()

    await vi.waitFor(() => {
      expect(wrapper.get('video').attributes('src')).toBe('https://r2.example.com/refreshed.mp4')
    })
  })

  it('restores the selected model and generation parameters after remounting', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'grok-imagine-video' }, { id: 'seedance-2.5' }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const first = mountStudio()
    await flushPromises()
    await flushPromises()
    const modelButton = first.get('[data-testid="video-model-select"]')
      .findAll('button')
      .find((button) => button.text() === 'seedance-2.5')
    expect(modelButton).toBeDefined()
    await modelButton!.trigger('click')
    await first.findAll('[data-testid="video-resolution-control"] button')
      .find((button) => button.text() === '1080P')!
      .trigger('click')
    const durationInput = first.get('[data-testid="video-duration-control"] input')
    await durationInput.setValue('30')
    await durationInput.trigger('blur')
    const taskCountInput = first.get('[data-testid="video-task-count"]')
    await taskCountInput.setValue('2')
    await taskCountInput.trigger('blur')
    await first.get('[role="switch"]').trigger('click')
    await flushPromises()
    first.unmount()

    const second = mountStudio()
    await flushPromises()
    await flushPromises()
    expect(second.get('[data-testid="video-model-select"]').text()).toContain('seedance-2.5')
    expect((second.get('[data-testid="video-duration-control"] input').element as HTMLInputElement).value).toBe('30')
    expect(second.findAll('[data-testid="video-resolution-control"] button')
      .find((button) => button.classes('is-active'))?.text()).toBe('1080P')
    expect((second.get('[data-testid="video-task-count"]').element as HTMLInputElement).value).toBe('2')
    expect(second.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    second.unmount()
  })

})

describe('VideoStudioView grok generation', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:video'), revokeObjectURL: vi.fn() })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('uses the xAI video endpoints and downloads the content with the key', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'grok-imagine-video' }] })
      }
      if (url.endsWith('/videos/generations') && init?.method === 'POST') {
        return jsonResponse({ request_id: 'req-9' })
      }
      if (url.endsWith('/videos/req-9') && !url.endsWith('/content')) {
        return jsonResponse({ status: 'done', video: { url: 'https://xai.example.com/v.mp4', duration: 8 } })
      }
      if (url.endsWith('/videos/req-9/content')) {
        return { ok: true, status: 200, statusText: 'OK', blob: async () => new Blob(['video']) } as unknown as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.get('[data-testid="video-resolution-control"]').attributes('style'))
      .toContain('--video-segment-count: 2')
    expect(wrapper.get('[data-testid="video-duration-control"] .video-composer__segmented').attributes('style'))
      .toContain('--video-segment-count: 3')

    await wrapper.get('textarea').setValue('海浪拍打礁石')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).endsWith('/videos/generations') && call[1]?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    const payload = JSON.parse(String(createCall?.[1]?.body))
    expect(payload.aspect_ratio).toBe('16:9')
    expect(payload.duration).toBe(5)

    const contentCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/videos/req-9/content'))
    expect(contentCall).toBeDefined()
    expect((contentCall?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer sk-video')
    expect(wrapper.get('video').attributes('src')).toBe('blob:video')
  })
})

describe('VideoStudioView references', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('adds a reference video url into the Seedance content array', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        return jsonResponse({ id: 'task-2' })
      }
      if (url.endsWith('/contents/generations/tasks/task-2')) {
        return jsonResponse({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/x.mp4' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await wrapper.get('[data-testid="video-reference-trigger"]').trigger('click')
    await wrapper.get('[data-testid="reference-kind-video"]').trigger('click')
    await wrapper.get('[data-testid="reference-url-input"]').setValue('https://cdn.example.com/ref.mp4')
    const addButton = wrapper.findAll('button').find((button) => button.text() === '添加')
    await addButton!.trigger('click')
    await flushPromises()

    await wrapper.get('textarea').setValue('延续上一个镜头')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).endsWith('/contents/generations/tasks') && call[1]?.method === 'POST',
    )
    const payload = JSON.parse(String(createCall?.[1]?.body))
    expect(payload.content).toContainEqual({
      type: 'video_url',
      video_url: { url: 'https://cdn.example.com/ref.mp4' },
    })
  })

  it('keeps the prompt and reference assets when the studio remounts', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const firstWrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await firstWrapper.get('textarea').setValue('保留这个视频镜头描述')
    await firstWrapper.get('[data-testid="video-reference-trigger"]').trigger('click')
    await firstWrapper.get('[data-testid="reference-kind-video"]').trigger('click')
    await firstWrapper.get('[data-testid="reference-url-input"]').setValue('https://cdn.example.com/keep-ref.mp4')
    const addButton = firstWrapper.findAll('button').find((button) => button.text() === '添加')
    await addButton!.trigger('click')
    await flushPromises()
    firstWrapper.unmount()

    const secondWrapper = mountStudio()
    expect((secondWrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('保留这个视频镜头描述')
    expect(secondWrapper.get('[aria-label="移除 keep-ref.mp4"]').exists()).toBe(true)
  })

  it('moves delete to the right and asks for confirmation before removing a result', async () => {
    saveVideoWork({
      id: 'vw-delete-confirm',
      provider: 'seedance_video',
      requestId: 'task-delete-confirm',
      keyId: 7,
      model: 'seedance-2.5',
      prompt: '需要删除的视频',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
      referenceCounts: { images: 0, videos: 0, audios: 0 },
      videoUrl: '',
      createdAt: Date.now(),
      status: 'queued',
      statusMessage: '',
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2.5' }] })
      if (url.endsWith('/videos/task-delete-confirm')) {
        return jsonResponse({ status: 'failed', error: { message: 'test failure' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    const deleteButton = wrapper.get('[title="删除记录"]')
    expect(wrapper.get('.video-card__actions button:last-child').attributes('title')).toBe('删除记录')
    await deleteButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('确定删除这条视频记录吗？')
    expect(wrapper.get('.video-card').exists()).toBe(true)
    await wrapper.get('[data-testid="confirm-delete-task"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('video').exists()).toBe(false)
    expect(localStorage.getItem('sub2api:video-studio:works')).toBe('[]')
  })
})

describe('VideoStudioView inspiration handoff', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('prefills the editor from the inspiration query parameter', async () => {
    routeQuery.value = { inspiration: 'clay-fox-starlight' }
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toContain('手工黏土动画风格')
    expect(wrapper.get('[data-testid="inspiration-hint"]').text()).toContain('小狐狸发现星光')
    const durationInput = wrapper.get('[data-testid="video-duration-control"] input')
    expect((durationInput.element as HTMLInputElement).value).toBe('10')
  })

  it('picks up an online prompt handed over from the inspiration library', async () => {
    sessionStorage.setItem('sub2api:video-studio:pending-prompt', '动物耳朵女孩的微笑，耳朵微微颤动。')
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(
      '动物耳朵女孩的微笑，耳朵微微颤动。',
    )
    expect(wrapper.get('[data-testid="inspiration-hint"]').text()).toContain('已带入在线灵感提示词')
    // 读完即清，避免下次进来又被旧提示词覆盖。
    expect(sessionStorage.getItem('sub2api:video-studio:pending-prompt')).toBeNull()
  })

  it('keeps the edited prompt when the toolbar refresh reloads keys and models', async () => {
    routeQuery.value = { inspiration: 'clay-fox-starlight' }
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toContain('手工黏土动画风格')

    await wrapper.get('textarea').setValue('我自己改过的镜头描述')
    await wrapper.get('[data-testid="video-refresh"]').trigger('click')
    await flushPromises()
    await flushPromises()

    // 刷新只该重载密钥和模型，不能把模板提示词再套一遍覆盖用户输入。
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('我自己改过的镜头描述')
  })
})

describe('VideoStudioView custom provider', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('posts to the user-supplied endpoint with the user-supplied key', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        return jsonResponse({ id: 'task-c1' })
      }
      if (url.endsWith('/contents/generations/tasks/task-c1')) {
        return jsonResponse({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/c.mp4' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await wrapper.get('[data-testid="provider-custom"]').trigger('click')
    await wrapper.get('[data-testid="custom-base-url"]').setValue('https://third.example.com/v1/')
    await wrapper.get('[data-testid="custom-api-key"]').setValue('third-key')
    await wrapper.get('[data-testid="custom-model"]').setValue('seedance-2-720p')
    await wrapper.get('textarea').setValue('走自己的渠道生成这段镜头')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === 'https://third.example.com/v1/contents/generations/tasks'
        && call[1]?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    expect((createCall?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer third-key')
    expect(wrapper.get('video').attributes('src')).toBe('https://cdn.example.com/c.mp4')
  })

  it('pulls the model list from the custom endpoint with the custom key', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'seedance-2-720p' }, { id: 'gpt-4o' }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()

    await wrapper.get('[data-testid="provider-custom"]').trigger('click')
    await wrapper.get('[data-testid="custom-base-url"]').setValue('https://third.example.com/v1')
    await wrapper.get('[data-testid="custom-api-key"]').setValue('third-key')
    await wrapper.get('[data-testid="custom-models-load"]').trigger('click')
    await flushPromises()

    const options = wrapper.findAll('datalist option').map((option) => option.attributes('value'))
    expect(options).toContain('seedance-2-720p')
    expect(options).not.toContain('gpt-4o')
    expect((wrapper.get('[data-testid="custom-model"]').element as HTMLInputElement).value)
      .toBe('seedance-2-720p')
  })

  it('shows an empty model list as a top-right toast', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()

    await wrapper.get('[data-testid="provider-custom"]').trigger('click')
    await wrapper.get('[data-testid="custom-base-url"]').setValue('https://third.example.com/v1')
    await wrapper.get('[data-testid="custom-api-key"]').setValue('third-key')
    await wrapper.get('[data-testid="custom-models-load"]').trigger('click')
    await flushPromises()

    expect(useAppStore().toasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'warning',
          message: '没有读到模型，可以直接手写模型名。',
        }),
      ]),
    )
  })

  it('keeps the custom key out of localStorage', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()

    await wrapper.get('[data-testid="provider-custom"]').trigger('click')
    await wrapper.get('[data-testid="custom-base-url"]').setValue('https://third.example.com/v1')
    await wrapper.get('[data-testid="custom-api-key"]').setValue('third-secret')
    await flushPromises()

    expect(localStorage.getItem('sub2api:video-studio:provider')).not.toContain('third-secret')
  })
})

describe('VideoStudioView reference limits', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('rejects a reference image that goes over the per-file size limit', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await wrapper.get('[data-testid="video-reference-trigger"]').trigger('click')

    const input = wrapper.get('input[type="file"]')
    const oversized = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      'huge.png',
      { type: 'image/png' },
    )
    Object.defineProperty(input.element, 'files', { value: [oversized], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('单个文件不能超过 5MB')
    expect(wrapper.findAll('.reference-chip').length).toBe(0)
  })

  it('accepts a reference video through the file picker up to 20MB', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [] })
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await wrapper.get('[data-testid="video-reference-trigger"]').trigger('click')
    await wrapper.get('[data-testid="reference-kind-video"]').trigger('click')

    expect(wrapper.get('input[type="file"]').attributes('accept')).toContain('video/mp4')

    const small = new File([new Uint8Array(1024)], 'clip.mp4', { type: 'video/mp4' })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [small], configurable: true })
    await input.trigger('change')
    // FileReader 的 load 回调落在宏任务里，等它跑完再断言。
    await vi.waitFor(() => {
      expect(wrapper.findAll('.video-composer__reference').length).toBe(1)
    })
    expect(wrapper.get('.video-composer__reference').text()).toContain('参考视频')
  })
})

describe('VideoStudioView unfinished work resumption', () => {
  beforeEach(() => {
    resetMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('does not mount a second card for the same unfinished record on refresh', async () => {
    saveVideoWork({
      id: 'vw_pending',
      provider: 'seedance',
      requestId: 'task-pending',
      keyId: 7,
      model: 'seedance-2-720p',
      prompt: '还没跑完的镜头',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
      referenceCounts: { images: 0, videos: 0, audios: 0 },
      videoUrl: '',
      createdAt: Date.now(),
      status: 'running',
      statusMessage: '生成中',
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'seedance-2-720p' }] })
      if (url.includes('/contents/generations/tasks/')) {
        // 立刻收敛成失败，避免测试里留着一条长轮询。
        return jsonResponse({ status: 'failed', failure_reason: 'test' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountStudio()
    await flushPromises()
    await flushPromises()
    expect(wrapper.findAll('article').length).toBe(1)
    const pollsAfterMount = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/contents/generations/tasks/'),
    ).length
    expect(pollsAfterMount).toBe(1)

    await wrapper.get('[data-testid="video-refresh"]').trigger('click')
    await flushPromises()
    await flushPromises()

    // 未完成的任务在刷新后仍然只占一张卡，也不会再发起第二路轮询。
    expect(wrapper.findAll('article').length).toBe(1)
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).includes('/contents/generations/tasks/')).length,
    ).toBe(pollsAfterMount)
  })
})
