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

const { listArchivedVideos, deleteArchivedVideo, pinArchivedVideo, fetchOnlineInspirationFeed, fetchInspirationLibrary } = vi.hoisted(() => ({
  listArchivedVideos: vi.fn(),
  deleteArchivedVideo: vi.fn(),
  pinArchivedVideo: vi.fn(),
  fetchOnlineInspirationFeed: vi.fn(),
  fetchInspirationLibrary: vi.fn(),
}))

const { listImages, pinImage, deleteImage, downloadImage } = vi.hoisted(() => ({
  listImages: vi.fn(),
  pinImage: vi.fn(),
  deleteImage: vi.fn(),
  downloadImage: vi.fn(),
}))

vi.mock('../videoArchiveApi', () => ({
  listArchivedVideos,
  deleteArchivedVideo,
  pinArchivedVideo,
  fetchStudioWorksQuota: vi.fn().mockResolvedValue({ used: 2, limit: 100 }),
  isStudioQuotaError: () => false,
  fetchOnlineInspirationFeed,
  fetchInspirationLibrary,
  inspirationMediaProxyUrl: (rawUrl: string) =>
    `/api/v1/public/video-inspiration/media?u=${encodeURIComponent(rawUrl)}`,
  archiveVideo: vi.fn(),
}))

vi.mock('@/api', () => ({
  keysAPI: { list: listKeys },
  authAPI: { getPublicSettings },
  imageStudioGalleryAPI: {
    list: listImages,
    pin: pinImage,
    delete: deleteImage,
    download: downloadImage,
  },
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
    props: ['show', 'title', 'closeOnClickOutside'],
    emits: ['close'],
    // 只有打开 close-on-click-outside 时才有遮罩点击区域，用来验证"点周围关闭"。
    template:
      '<div v-if="show"><button v-if="closeOnClickOutside" data-testid="dialog-backdrop" @click="$emit(\'close\')">backdrop</button><h3>{{ title }}</h3><slot /><slot name="footer" /></div>',
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
    await wrapper.get('[data-testid="inspiration-source-curated"]').trigger('click')
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
    await wrapper.get('[data-testid="inspiration-source-curated"]').trigger('click')
    const card = wrapper.get('[data-testid="template-perfume-light-reveal"]')
    await card.get('button').trigger('click')
    const useButton = wrapper.findAll('button').find((button) => button.text().includes('带入工作台'))
    await useButton!.trigger('click')

    expect(push).toHaveBeenCalledWith({
      path: '/video-studio',
      query: { inspiration: 'perfume-light-reveal' },
    })
  })

  it('closes the template detail when clicking outside, like the X button', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-curated"]').trigger('click')
    await wrapper.get('[data-testid="template-perfume-light-reveal"]').get('button').trigger('click')
    // 弹窗标题用 h3，卡片标题用 h2：用它判断弹窗开/关，避免和卡片里的提示词混淆。
    expect(wrapper.findAll('h3').length).toBe(1)

    await wrapper.get('[data-testid="dialog-backdrop"]').trigger('click')
    expect(wrapper.findAll('h3').length).toBe(0)
  })

  it('opens the image as a large preview with the prompt beside it', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-curated"]').trigger('click')
    const card = wrapper.get('[data-testid="template-perfume-light-reveal"]')
    await card.get('button').trigger('click')

    expect(wrapper.get('.detail').exists()).toBe(true)
    expect(wrapper.get('.detail__image').attributes('src')).toBe(
      '/api/v1/public/video-inspiration/media?u=' +
        encodeURIComponent('https://gen.nbility.ai/media/video-storyboards/perfume-light-reveal.webp'),
    )
    expect(wrapper.get('.detail__panel').text()).toContain('提示词')
    expect(wrapper.get('.detail__panel').text()).toContain('透明方形香水瓶')
  })

  // 模板库从自建灵感站接过来，卡片示例图（分镜图）经本站代理加载。
  it('loads the template storyboard through the media proxy', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-curated"]').trigger('click')
    const poster = wrapper.get('[data-testid="template-perfume-light-reveal"] img')
    expect(poster.attributes('src')).toBe(
      '/api/v1/public/video-inspiration/media?u=' +
        encodeURIComponent('https://gen.nbility.ai/media/video-storyboards/perfume-light-reveal.webp'),
    )
    expect(poster.attributes('loading')).toBe('lazy')

    // 分镜图取不到时退回色板底图，不再留破图。
    await poster.trigger('error')
    expect(wrapper.find('[data-testid="template-perfume-light-reveal"] img').exists()).toBe(false)
  })

  // 内置模板没有成片：不能出现"看起来能播但点了没反应"的播放键。
  it('labels built-in templates as storyboard previews without a play button', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-curated"]').trigger('click')
    const card = wrapper.get('[data-testid="template-perfume-light-reveal"]')
    expect(card.text()).toContain('分镜预览')
    expect(card.find('.inspiration-tile__type').exists()).toBe(false)
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
      limit: 48,
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

  it('falls back to the library when the online source is unreachable', async () => {
    fetchOnlineInspirationFeed.mockRejectedValue(new Error('online inspiration source is unreachable'))
    fetchInspirationLibrary.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 60,
      has_more: false,
      total: 0,
      models: [],
      categories: [],
      fetched_at: 1760400000,
      stale: false,
    })

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="online-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="online-fallback"]').text()).toContain('已自动切换到作品库')
    expect(wrapper.get('[data-testid="inspiration-source-library"]').attributes('aria-selected')).toBe('true')
    expect(fetchInspirationLibrary).toHaveBeenCalled()
  })

  it('hands an online prompt to the studio without a long query string', async () => {
    fetchOnlineInspirationFeed.mockResolvedValue(onlineFeed)

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-online"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="online-60183831"]').get('button').trigger('click')
    const useButton = wrapper
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
    listImages.mockReset()
    listImages.mockResolvedValue([])
    pinImage.mockReset()
    pinImage.mockResolvedValue(undefined)
    deleteImage.mockReset()
    deleteImage.mockResolvedValue(undefined)
    downloadImage.mockReset()
    downloadImage.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    deleteArchivedVideo.mockReset()
    deleteArchivedVideo.mockResolvedValue(undefined)
    listKeys.mockResolvedValue({
      items: [{ id: 7, name: 'video-key', key: 'sk-video', status: 'active', group_id: 1 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
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

  it('lists saved image studio works alongside videos', async () => {
    listImages.mockResolvedValue([
      {
        id: 'image-1',
        url: 'https://cdn.example.com/saved-image.png',
        prompt: '一张已保存的海报',
        model: 'gpt-image-2',
        size: '1024x1024',
        format: 'png',
        saved: true,
        created_at: 1760000000,
        expires_at: 0,
      },
    ])

    const wrapper = mount(VideoWorksView, { global: { stubs: globalStubs } })
    await flushPromises()

    const card = wrapper.get('[data-testid="image-work-image-1"]')
    expect(card.text()).toContain('一张已保存的海报')
    expect(card.text()).toContain('已保存到我的作品')
    expect(card.get('img').attributes('src')).toBe('https://cdn.example.com/saved-image.png')
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
    // 删除要连带删对象存储里的文件，所以走一次确认框。
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await deleteButton!.trigger('click')
    await flushPromises()

    expect(deleteArchivedVideo).toHaveBeenCalledWith('arch-2')
    expect(wrapper.find('[data-testid="archived-arch-2"]').exists()).toBe(false)
    expect(confirmSpy).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // 临时内容默认带过期时间：卡片上要标"还剩 N 天"，并提供"存到我的作品"。
  it('marks temporary archives and pins them into the permanent library', async () => {
    listArchivedVideos.mockResolvedValue([
      {
        id: 'arch-temp',
        url: 'https://cdn.example.com/temp.mp4',
        prompt: '临时镜头',
        model: 'seedance-2-720p',
        format: 'mp4',
        duration_seconds: 5,
        saved: false,
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 7 * 86400,
      },
    ])
    pinArchivedVideo.mockResolvedValue(undefined)

    const wrapper = mount(VideoWorksView, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(wrapper.get('[data-testid="archived-temp-badge"]').text()).toContain('还剩 7 天')
    await wrapper.get('[data-testid="archived-pin"]').trigger('click')
    await flushPromises()

    expect(pinArchivedVideo).toHaveBeenCalledWith('arch-temp')
    expect(wrapper.find('[data-testid="archived-saved-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="archived-temp-badge"]').exists()).toBe(false)
  })
})

describe('VideoInspirationView library source', () => {
  const libraryPage = {
    items: [
      {
        id: 'prompt-1',
        type: 'video' as const,
        title: '香水瓶的光影揭幕',
        prompt: '一只无品牌、无文字的透明方形香水瓶立在深灰色石台中央。',
        model: 'Seedance',
        category: '产品广告',
        cover_url: '/api/v1/public/video-inspiration/media?u=storyboard.webp',
        source_cover: 'https://gen.nbility.ai/media/video-storyboards/perfume-light-reveal.webp',
        width: 0,
        height: 0,
        duration_seconds: 5,
        aspect_ratio: '16:9',
        resolution: '720p',
        likes: 0,
        views: 0,
        author: '',
        author_handle: '',
        source_url: 'https://gen.nbility.ai/video-prompts/perfume-light-reveal',
        has_cover: true,
      },
    ],
    page: 1,
    page_size: 24,
    has_more: true,
    total: 418,
    models: ['Seedance', 'Kling'],
    categories: ['产品广告', '美食饮品'],
    fetched_at: 1760400000,
    stale: false,
  }

  beforeEach(() => {
    push.mockReset()
    copyToClipboard.mockReset()
    copyToClipboard.mockResolvedValue(true)
    fetchInspirationLibrary.mockReset()
    fetchInspirationLibrary.mockResolvedValue(libraryPage)
  })

  it('lists library items with model, category and total', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-library"]').trigger('click')
    await flushPromises()

    expect(fetchInspirationLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video', model: 'all', category: 'all', page: 1 }),
    )
    expect(wrapper.get('[data-testid="library-summary"]').text()).toContain('共 418 条')
    const card = wrapper.get('[data-testid="library-prompt-1"]')
    expect(card.text()).toContain('Seedance')
    expect(card.get('img').attributes('src')).toBe('/api/v1/public/video-inspiration/media?u=storyboard.webp')
  })

  it('uses the library aspect ratio so mixed cards keep the masonry layout', async () => {
    fetchInspirationLibrary.mockResolvedValue({
      ...libraryPage,
      items: [{ ...libraryPage.items[0], id: 'prompt-vertical', aspect_ratio: '9:16' }],
    })

    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-library"]').trigger('click')
    await flushPromises()

    const media = wrapper.get('[data-testid="library-prompt-vertical"] .inspiration-tile__media')
    expect(media.attributes('style')).toContain('aspect-ratio: 9 / 16')
  })

  it('reloads with the keyword and keeps pagination state', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-library"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="library-search"]').setValue('咖啡')
    await wrapper.get('[data-testid="library-search-button"]').trigger('click')
    await flushPromises()
    expect(fetchInspirationLibrary).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: '咖啡', page: 1 }),
    )

    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    await flushPromises()
    // 加载更多要请求下一页，而不是把第一页再取一次。
    expect(fetchInspirationLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('hands a library prompt to the studio', async () => {
    const wrapper = mount(VideoInspirationView, { global: { stubs: globalStubs } })
    await wrapper.get('[data-testid="inspiration-source-library"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="library-prompt-1"]').get('button').trigger('click')
    const useButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('带入工作台'))
    await useButton!.trigger('click')

    expect(sessionStorage.getItem('sub2api:video-studio:pending-prompt')).toContain('透明方形香水瓶')
    expect(push).toHaveBeenCalledWith({ path: '/video-studio' })
  })
})
