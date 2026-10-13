import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VideoInspirationView from '../VideoInspirationView.vue'
import VideoWorksView from '../VideoWorksView.vue'
import { createVideoWorkId, saveVideoWork, type VideoWorkRecord } from '../videoWorks'

const { listKeys, getPublicSettings, copyToClipboard, push } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  getPublicSettings: vi.fn(),
  copyToClipboard: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/api', () => ({
  keysAPI: { list: listKeys },
  authAPI: { getPublicSettings },
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

const globalStubs = {
  AppLayout: { template: '<div><slot /></div>' },
  BaseDialog: {
    props: ['show', 'title'],
    emits: ['close'],
    template: '<div v-if="show"><h3>{{ title }}</h3><slot /><slot name="footer" /></div>',
  },
  Icon: { template: '<span />' },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  ImageStudioSelect: {
    props: ['modelValue', 'options', 'placeholder'],
    template: '<div>{{ options.find(o => o.value === modelValue)?.label || placeholder }}</div>',
  },
}

function seedRecord(overrides: Partial<VideoWorkRecord> = {}): VideoWorkRecord {
  return {
    id: createVideoWorkId(),
    provider: 'seedance',
    requestId: 'task-1',
    keyId: 7,
    model: 'seedance-2-720p',
    prompt: '云海在山脊之间缓慢流动',
    durationSeconds: 8,
    resolution: '720p',
    aspectRatio: '16:9',
    generateAudio: false,
    referenceCounts: { images: 0, videos: 0, audios: 0 },
    videoUrl: 'https://cdn.example.com/out.mp4',
    createdAt: Date.now(),
    status: 'succeeded',
    statusMessage: '',
    ...overrides,
  }
}

describe('VideoInspirationView', () => {
  beforeEach(() => {
    push.mockReset()
    copyToClipboard.mockReset()
    copyToClipboard.mockResolvedValue(true)
  })

  it('renders every template and filters by category', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    const allCards = wrapper.findAll('article')
    expect(allCards.length).toBeGreaterThan(5)

    await wrapper.get('[data-testid="inspiration-category-多图参考"]').trigger('click')
    const filtered = wrapper.findAll('article')
    expect(filtered.length).toBe(2)
    expect(wrapper.text()).toContain('角色走进新场景')
    expect(wrapper.text()).not.toContain('云海中的山脊')
  })

  it('sends the template slug to the studio when brought into the workbench', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    const card = wrapper.get('[data-testid="template-perfume-light-reveal"]')
    const useButton = card.findAll('button').find((button) => button.text().includes('带入工作台'))
    await useButton!.trigger('click')

    expect(push).toHaveBeenCalledWith({
      path: '/video-studio',
      query: { inspiration: 'perfume-light-reveal' },
    })
  })
})

describe('VideoInspirationView online source', () => {
  const onlinePayload = {
    items: [
      {
        id: 60183831,
        url: 'https://image.civitai.com/example/clip.mp4',
        thumbnail: { url: 'https://image.civitai.com/example/thumb.jpeg' },
        width: 1080,
        height: 1920,
        type: 'video',
        nsfw: false,
        nsfwLevel: 'None',
        baseModel: 'Illustrious',
        username: 'HshiKoi',
        stats: { likeCount: 5989 },
        meta: {
          prompt: '动物耳朵女孩的微笑，头发轻轻飘动，耳朵微微颤动。',
          negativePrompt: 'blurry, watermark',
        },
      },
      {
        // 没有提示词的条目会被丢掉，只保留可复制的灵感。
        id: 2,
        url: 'https://image.civitai.com/example/nop.mp4',
        type: 'video',
        nsfw: false,
        nsfwLevel: 'None',
        meta: {},
      },
    ],
  }

  beforeEach(() => {
    push.mockReset()
    copyToClipboard.mockReset()
    copyToClipboard.mockResolvedValue(true)
    vi.stubGlobal('fetch', vi.fn())
  })

  it('plays the sample video next to its prompt and copies the prompt', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => onlinePayload,
    } as unknown as Response)

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('type=video')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('withMeta=true')
    expect(wrapper.find('[data-testid="online-2"]').exists()).toBe(false)

    const card = wrapper.get('[data-testid="online-60183831"]')
    expect(card.text()).toContain('Illustrious')
    await card.get('button').trigger('click')

    const video = wrapper.get('[data-testid="inspiration-video"]')
    expect(video.attributes('src')).toBe('https://image.civitai.com/example/clip.mp4')
    expect(video.attributes('poster')).toBe('https://image.civitai.com/example/thumb.jpeg')
    expect(wrapper.text()).toContain('动物耳朵女孩的微笑')

    await wrapper.get('[data-testid="inspiration-copy"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledWith(
      '动物耳朵女孩的微笑，头发轻轻飘动，耳朵微微颤动。',
      expect.any(String),
    )
  })

  it('explains an unreachable source instead of showing an empty page', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="online-error"]').text()).toContain('无法访问在线灵感源')
  })

  it('hands an online prompt to the studio without a long query string', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => onlinePayload,
    } as unknown as Response)

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    const useButton = wrapper
      .get('[data-testid="online-60183831"]')
      .findAll('button')
      .find((button) => button.text().includes('带入工作台'))
    await useButton!.trigger('click')

    expect(sessionStorage.getItem('sub2api:video-studio:pending-prompt')).toContain('动物耳朵女孩的微笑')
    expect(push).toHaveBeenCalledWith({ path: '/video-studio' })
  })
})

describe('VideoWorksView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    listKeys.mockResolvedValue({
      items: [{ id: 7, name: 'video-key', key: 'sk-video', status: 'active', group_id: 1 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: 'https://api.superai.sbs/v1' })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('lists saved works and plays the stored url', async () => {
    saveVideoWork(seedRecord())
    const wrapper = mount(VideoWorksView, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('云海在山脊之间缓慢流动')
    expect(wrapper.text()).toContain('seedance-2-720p')
    expect(wrapper.get('video').attributes('src')).toBe('https://cdn.example.com/out.mp4')
  })

  it('shows the empty state after clearing every record', async () => {
    saveVideoWork(seedRecord())
    const wrapper = mount(VideoWorksView, { global: { stubs: globalStubs } })
    await flushPromises()
    expect(wrapper.findAll('article').length).toBe(1)

    await wrapper.get('[data-testid="works-clear"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('article').length).toBe(0)
    expect(wrapper.text()).toContain('还没有作品')
  })
})
