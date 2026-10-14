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

const { listArchivedVideos, deleteArchivedVideo, fetchOnlineInspirationFeed } = vi.hoisted(() => ({
  listArchivedVideos: vi.fn(),
  deleteArchivedVideo: vi.fn(),
  fetchOnlineInspirationFeed: vi.fn(),
}))

vi.mock('../videoArchiveApi', () => ({
  listArchivedVideos,
  deleteArchivedVideo,
  fetchOnlineInspirationFeed,
  archiveVideo: vi.fn(),
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
  const onlineFeed = {
    items: [
      {
        id: '60183831',
        media_type: 'video' as const,
        media_url: '/api/v1/public/video-inspiration/media?u=clip.mp4',
        poster_url: '/api/v1/public/video-inspiration/media?u=thumb.jpeg',
        prompt: '动物耳朵女孩的微笑，头发轻轻飘动，耳朵微微颤动。',
        negative_prompt: 'blurry, watermark',
        model: 'Illustrious',
        author: 'HshiKoi',
        width: 1080,
        height: 1920,
        likes: 5989,
        source_url: 'https://civitai.com/images/60183831',
      },
    ],
    source: 'civitai',
    media_type: 'video',
    sort: 'newest',
    period: 'week',
    fetched_at: 1760400000,
    cached: false,
  }

  beforeEach(() => {
    push.mockReset()
    copyToClipboard.mockReset()
    copyToClipboard.mockResolvedValue(true)
    fetchOnlineInspirationFeed.mockReset()
  })

  it('plays the sample video next to its prompt and copies the prompt', async () => {
    fetchOnlineInspirationFeed.mockResolvedValue(onlineFeed)

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    // 拉取走本站后端，浏览器不再直连第三方站点；默认按「最新」取，做出日更效果。
    expect(fetchOnlineInspirationFeed).toHaveBeenCalledWith({
      mediaType: 'video',
      sort: 'newest',
      period: 'week',
      limit: 24,
      refresh: false,
    })

    const card = wrapper.get('[data-testid="online-60183831"]')
    expect(card.text()).toContain('Illustrious')
    await card.get('button').trigger('click')

    const video = wrapper.get('[data-testid="inspiration-video"]')
    expect(video.attributes('src')).toBe('/api/v1/public/video-inspiration/media?u=clip.mp4')
    expect(video.attributes('poster')).toBe('/api/v1/public/video-inspiration/media?u=thumb.jpeg')
    expect(wrapper.text()).toContain('动物耳朵女孩的微笑')

    await wrapper.get('[data-testid="inspiration-copy"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledWith(
      '动物耳朵女孩的微笑，头发轻轻飘动，耳朵微微颤动。',
      expect.any(String),
    )
  })

  it('explains an unreachable source instead of showing an empty page', async () => {
    fetchOnlineInspirationFeed.mockRejectedValue(new Error('online inspiration source is unreachable'))

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    const error = wrapper.get('[data-testid="online-error"]').text()
    expect(error).toContain('拉取在线灵感失败')
    expect(error).toContain('update.proxy_url')
  })

  it('hands an online prompt to the studio without a long query string', async () => {
    fetchOnlineInspirationFeed.mockResolvedValue(onlineFeed)

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

  it('bypasses the server cache when asking for another batch', async () => {
    fetchOnlineInspirationFeed.mockResolvedValue(onlineFeed)

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="online-refresh"]').trigger('click')
    await flushPromises()

    // 首次加载走缓存；点「换一批」必须要求服务端重新拉取。
    expect(fetchOnlineInspirationFeed).toHaveBeenNthCalledWith(1, expect.objectContaining({ refresh: false }))
    expect(fetchOnlineInspirationFeed).toHaveBeenNthCalledWith(2, expect.objectContaining({ refresh: true }))
  })

  it('reloads with the chosen media type and period', async () => {
    fetchOnlineInspirationFeed.mockResolvedValue(onlineFeed)

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="online-media-image"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="online-period-day"]').trigger('click')
    await flushPromises()

    // 切到「图片 + 今天」要重新按新条件取，而不是复用视频那批。
    expect(fetchOnlineInspirationFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaType: 'image', period: 'day' }),
    )
  })
})

describe('VideoWorksView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    listArchivedVideos.mockReset()
    listArchivedVideos.mockResolvedValue([])
    deleteArchivedVideo.mockReset()
    deleteArchivedVideo.mockResolvedValue(undefined)
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

  it('lists archived videos and hides the duplicate local record', async () => {
    const archivedEntry = {
      id: 'arch-1',
      url: 'https://cdn.example.com/archived.mp4',
      prompt: '已归档的镜头',
      model: 'seedance-2-720p',
      format: 'mp4',
      duration_seconds: 8,
      created_at: 1760000000,
      expires_at: 1900000000,
    }
    listArchivedVideos.mockResolvedValue([archivedEntry])
    // 同一条视频本地也留了记录：不该重复显示。
    saveVideoWork(seedRecord({ archivedUrl: archivedEntry.url }))

    const wrapper = mount(VideoWorksView, { global: { stubs: globalStubs } })
    await flushPromises()

    const card = wrapper.get('[data-testid="archived-arch-1"]')
    expect(card.text()).toContain('已归档的镜头')
    expect(card.get('video').attributes('src')).toBe('https://cdn.example.com/archived.mp4')
    expect(wrapper.findAll('[data-testid^="work-"]').length).toBe(0)
  })

  it('deletes an archived entry through the archive API', async () => {
    listArchivedVideos.mockResolvedValue([
      {
        id: 'arch-2',
        url: 'https://cdn.example.com/archived-2.mp4',
        prompt: '要删掉的镜头',
        model: 'seedance-2-720p',
        format: 'mp4',
        duration_seconds: 5,
        created_at: 1760000000,
        expires_at: 1900000000,
      },
    ])

    const wrapper = mount(VideoWorksView, { global: { stubs: globalStubs } })
    await flushPromises()

    const card = wrapper.get('[data-testid="archived-arch-2"]')
    const deleteButton = card.findAll('button').find((button) => button.attributes('title') === '删除归档')
    await deleteButton!.trigger('click')
    await flushPromises()

    expect(deleteArchivedVideo).toHaveBeenCalledWith('arch-2')
    expect(wrapper.find('[data-testid="archived-arch-2"]').exists()).toBe(false)
  })
})
