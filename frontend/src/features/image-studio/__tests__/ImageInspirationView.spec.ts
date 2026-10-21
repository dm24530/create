import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageInspirationView from '../ImageInspirationView.vue'

const {
  push,
  copyToClipboard,
  fetchInspirationLibrary,
  fetchOnlineInspirationFeed,
} = vi.hoisted(() => ({
  push: vi.fn(),
  copyToClipboard: vi.fn(),
  fetchInspirationLibrary: vi.fn(),
  fetchOnlineInspirationFeed: vi.fn(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({ push }),
  }
})

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard }),
}))

vi.mock('../../video-studio/videoArchiveApi', () => ({
  fetchInspirationLibrary,
  fetchOnlineInspirationFeed,
}))

const globalStubs = {
  AppLayout: { template: '<div><slot /></div>' },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  ImageStudioSelect: {
    props: ['modelValue', 'options'],
    template: '<span class="select-stub">{{ options?.length || 0 }}</span>',
  },
  BaseDialog: {
    props: ['show', 'title'],
    emits: ['close'],
    template: '<div v-if="show"><h3>{{ title }}</h3><slot /><slot name="footer" /></div>',
  },
  Icon: { template: '<span />' },
}

const libraryPage = {
  items: [
    {
      id: 'image-1',
      type: 'image' as const,
      title: '薄雾中的现代建筑',
      prompt: '清晨薄雾中的现代建筑，克制的灰蓝色调，长焦构图。',
      model: 'Flux',
      category: '建筑',
      cover_url: '/api/v1/public/video-inspiration/media?u=building.webp',
      source_cover: 'https://cdn.example.com/building.webp',
      width: 1536,
      height: 1024,
      duration_seconds: 0,
      aspect_ratio: '3:2',
      resolution: '',
      likes: 128,
      views: 960,
      author: 'Lin',
      author_handle: 'lin',
      source_url: 'https://gen.nbility.ai/explore/image-1',
      has_cover: true,
    },
  ],
  page: 1,
  page_size: 60,
  has_more: false,
  total: 37,
  models: ['Flux', 'Seedream'],
  categories: ['建筑', '产品'],
  fetched_at: 1760400000,
  stale: false,
}

describe('ImageInspirationView', () => {
  beforeEach(() => {
    push.mockReset()
    copyToClipboard.mockReset()
    copyToClipboard.mockResolvedValue(true)
    fetchInspirationLibrary.mockReset()
    fetchInspirationLibrary.mockResolvedValue(libraryPage)
    fetchOnlineInspirationFeed.mockReset()
    sessionStorage.clear()
  })

  it('loads image-only library items by default', async () => {
    const wrapper = mount(ImageInspirationView, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(fetchInspirationLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image', model: 'all', category: 'all', page: 1 }),
    )
    expect(wrapper.get('[data-testid="image-library-summary"]').text()).toContain('共 43 条')
    const card = wrapper.get('[data-testid="image-library-image-1"]')
    expect(card.text()).toContain('薄雾中的现代建筑')
    expect(card.get('img').attributes('src')).toBe('/api/v1/public/video-inspiration/media?u=building.webp')
    expect(card.get('.image-inspiration-tile__media').attributes('style')).toContain('aspect-ratio: 1536 / 1024')
  })

  it('copies and hands a library prompt to Image Studio', async () => {
    const wrapper = mount(ImageInspirationView, { global: { stubs: globalStubs } })
    await flushPromises()

    await wrapper.get('[data-testid="image-library-image-1"]').get('button').trigger('click')
    expect(wrapper.text()).toContain('清晨薄雾中的现代建筑')

    await wrapper.get('[data-testid="image-inspiration-copy"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledWith(
      '清晨薄雾中的现代建筑，克制的灰蓝色调，长焦构图。',
      '提示词已复制',
    )

    await wrapper.get('[data-testid="image-inspiration-use"]').trigger('click')
    expect(sessionStorage.getItem('sub2api:image-studio:pending-prompt')).toContain('清晨薄雾')
    expect(push).toHaveBeenCalledWith({ path: '/image-studio' })
  })

  it('does not expose the online inspiration source', async () => {
    const wrapper = mount(ImageInspirationView, { global: { stubs: globalStubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="image-inspiration-source-online"]').exists()).toBe(false)
  })
})
