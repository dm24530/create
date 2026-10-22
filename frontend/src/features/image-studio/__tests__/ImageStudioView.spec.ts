import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageStudioView from '../ImageStudioView.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { listKeys, getPublicSettings, listGallery, saveGallery, pinGallery, deleteGallery, downloadGallery, galleryQuota, copyToClipboard } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  getPublicSettings: vi.fn(),
  listGallery: vi.fn(),
  saveGallery: vi.fn(),
  pinGallery: vi.fn(),
  deleteGallery: vi.fn(),
  downloadGallery: vi.fn(),
  galleryQuota: vi.fn(),
  copyToClipboard: vi.fn(),
}))

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
  },
  authAPI: {
    getPublicSettings,
  },
  imageStudioGalleryAPI: {
    list: listGallery,
    save: saveGallery,
    pin: pinGallery,
    delete: deleteGallery,
    download: downloadGallery,
    quota: galleryQuota,
  },
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard,
  }),
}))

vi.mock('@/composables/useCreatorKey', () => ({
  isCreationServiceUnavailable: (error: unknown) =>
    String((error as { message?: unknown } | null)?.message ?? error ?? '')
      .includes('NO_IMAGE_CREATION_SERVICE'),
  ensureCreatorKey: async () => {
    const result = await listKeys()
    const key = result.items.find((item: any) => item.group?.allow_image_generation !== false) || result.items[0]
    return { keys: result.items, key }
  },
}))

const componentPath = resolve(dirname(fileURLToPath(import.meta.url)), '../ImageStudioView.vue')
const componentSource = readFileSync(componentPath, 'utf8')

function mountImageStudio(options: { isAdmin?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const authStore = useAuthStore(pinia)
  authStore.user = {
    id: options.isAdmin ? 1 : 2,
    email: options.isAdmin ? 'admin@example.com' : 'user@example.com',
    role: options.isAdmin ? 'admin' : 'user',
  } as any
  return mount(ImageStudioView, {
    global: {
      plugins: [pinia],
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        BaseDialog: {
          props: ['show', 'title', 'closeOnClickOutside'],
          emits: ['close'],
          template: '<div v-if="show"><button v-if="closeOnClickOutside" data-testid="dialog-backdrop" @click="$emit(\'close\')">backdrop</button><h3>{{ title }}</h3><slot /><slot name="footer" /></div>',
        },
        ConfirmDialog: {
          props: ['show', 'title', 'message', 'confirmText', 'cancelText', 'danger'],
          emits: ['confirm', 'cancel'],
          template: '<div v-if="show" data-testid="image-delete-confirm"><h3>{{ title }}</h3><p>{{ message }}</p><button data-testid="confirm-delete-image" @click="$emit(\'confirm\')">{{ confirmText }}</button><button data-testid="cancel-delete-image" @click="$emit(\'cancel\')">{{ cancelText }}</button></div>',
        },
        Icon: { template: '<span />' },
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  })
}

function resetCommonMocks() {
  listKeys.mockReset()
  getPublicSettings.mockReset()
  listGallery.mockReset()
  saveGallery.mockReset()
  pinGallery.mockReset()
  deleteGallery.mockReset()
  downloadGallery.mockReset()
  galleryQuota.mockReset()
  copyToClipboard.mockReset()
  listGallery.mockResolvedValue([])
  pinGallery.mockResolvedValue(undefined)
  deleteGallery.mockResolvedValue(undefined)
  downloadGallery.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  galleryQuota.mockResolvedValue({ used: 0, limit: 100 })
  copyToClipboard.mockResolvedValue(true)
  saveGallery.mockResolvedValue({
    id: 'gallery-1',
    url: 'https://cdn.example.com/gallery-1.png',
    prompt: '',
    model: '',
    size: '',
    format: '',
    created_at: 0,
    expires_at: 0,
  })
}

describe('ImageStudioView API key selector', () => {
  it('shows only the API key name', () => {
    expect(componentSource).toContain('label: key.name')
    expect(componentSource).not.toContain('maskApiKey')
  })
})

describe('ImageStudioView image model loading', () => {
  beforeEach(() => {
    resetCommonMocks()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    })
  })

  it('automatically loads and deduplicates image models from the batch endpoint', async () => {
    listKeys.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'dd',
          key: 'sk-local',
          status: 'active',
          group_id: 2,
        },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-image-1' },
              { id: ' gpt-image-2-5-flare ' },
              { id: 'GPT-IMAGE-2-5-FLARE' },
              { id: 'gpt-image-2-5-flare' },
            ],
          }),
        } as Response
      }
      if (url.endsWith('/models')) {
        throw new Error('generic models endpoint should not be requested when batch models exist')
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/v1/images/batches/models', {
      headers: { Authorization: 'Bearer sk-local' },
    })
    expect(fetchMock).not.toHaveBeenCalledWith('/v1/models', expect.anything())

    const apiKeySelect = wrapper.get('[data-testid="api-key-select"]')
    expect(apiKeySelect.text()).toContain('dd')
    expect(apiKeySelect.classes()).toContain('studio-select--down')

    const modelSelect = wrapper.get('[data-testid="image-model-select"]')
    expect(modelSelect.text()).toContain('gpt-image-1')
    expect(modelSelect.classes()).toContain('studio-select--down')
    expect(modelSelect.text()).not.toContain('nano-banana-2')
    expect(modelSelect.text()).not.toContain('gpt-5')

    await apiKeySelect.get('button').trigger('click')
    expect(apiKeySelect.text()).not.toContain('选择密钥')
    expect(apiKeySelect.text()).toContain('dd')

    await modelSelect.get('button').trigger('click')
    expect(modelSelect.text()).toContain('gpt-image-1')
    expect(modelSelect.text()).toContain('gpt-image-2-5-flare')
    expect(modelSelect.text().match(/gpt-image-2-5-flare/g)).toHaveLength(1)
    expect(wrapper.find('input[placeholder="输入图片模型"]').exists()).toBe(false)
  })

  it('reloads keys and models when the toolbar refresh button is pressed', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const modelCallsBefore = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith('/images/batches/models')).length
    const keyCallsBefore = listKeys.mock.calls.length
    expect(modelCallsBefore).toBeGreaterThan(0)

    await wrapper.get('[data-testid="image-refresh"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(listKeys.mock.calls.length).toBeGreaterThan(keyCallsBefore)
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/images/batches/models')).length,
    ).toBeGreaterThan(modelCallsBefore)
  })

  it('only exposes image-capable API keys', async () => {
    listKeys.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'text-only',
          key: 'sk-text',
          status: 'active',
          group_id: 1,
          group: { platform: 'anthropic', allow_image_generation: false },
        },
        {
          id: 2,
          name: 'image-key',
          key: 'sk-image',
          status: 'active',
          group_id: 2,
          group: { platform: 'openai', allow_image_generation: true },
        },
        {
          id: 3,
          name: 'ungrouped',
          key: 'sk-ungrouped',
          status: 'active',
          group_id: null,
        },
        {
          id: 4,
          name: 'legacy-group',
          key: 'sk-legacy',
          status: 'active',
          group_id: 4,
          group: { platform: 'openai' },
        },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '' })

    const wrapper = mountImageStudio()
    await flushPromises()

    const apiKeySelect = wrapper.get('[data-testid="api-key-select"]')
    expect(apiKeySelect.text()).toContain('image-key')
    expect(apiKeySelect.text()).not.toContain('text-only')

    await apiKeySelect.get('button').trigger('click')
    expect(apiKeySelect.text()).toContain('image-key')
    expect(apiKeySelect.text()).toContain('ungrouped')
    expect(apiKeySelect.text()).toContain('legacy-group')
    expect(apiKeySelect.text()).not.toContain('text-only')
  })

  it('renders keys before public settings finish loading', async () => {
    let resolveSettings: (value: any) => void = () => {}
    listKeys.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'dd',
          key: 'sk-local',
          status: 'active',
          group_id: 2,
        },
      ],
    })
    getPublicSettings.mockReturnValue(new Promise((resolve) => {
      resolveSettings = resolve
    }))

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('[data-testid="api-key-select"]').text()).toContain('dd')

    resolveSettings({ api_base_url: '/v1' })
    await flushPromises()
  })

  it('keeps loaded keys visible when public settings fail', async () => {
    listKeys.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'dd',
          key: 'sk-local',
          status: 'active',
          group_id: 2,
        },
      ],
    })
    getPublicSettings.mockRejectedValue({
      status: 0,
      code: 'ERR_NETWORK',
      message: 'Network error. Please check your connection.',
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.get('[data-testid="api-key-select"]').text()).toContain('dd')
    expect(useAppStore().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        message: '无法连接到 API 服务，请检查网络或 API 地址。',
      }),
    ]))
  })

  it('shows insufficient balance errors in Chinese', async () => {
    listKeys.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'dd',
          key: 'sk-local',
          status: 'active',
          group_id: 2,
        },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      json: async () => ({
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient account balance',
        },
      }),
    } as Response)

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('账户余额不足')
    expect(wrapper.text()).not.toContain('Insufficient account balance')
  })

  it('does not show a redundant error when no image models are available', async () => {
    listKeys.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'dd',
          key: 'sk-local',
          status: 'active',
          group_id: 2,
        },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response)

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.get('[data-testid="image-model-select"]').text()).toContain('选择模型')
    expect(wrapper.text()).not.toContain('该 API Key 暂无可用图片模型')
  })
})

describe('ImageStudioView inline image size controls', () => {
  beforeEach(() => {
    resetCommonMocks()
    listKeys.mockResolvedValue({ items: [] })
    getPublicSettings.mockResolvedValue({ api_base_url: '' })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('opens the inline size menu and applies custom dimensions', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    const trigger = wrapper.get('[data-testid="image-size-trigger"]')
    expect(trigger.text()).toContain('1024x1024')

    await trigger.trigger('click')
    expect(wrapper.find('[data-testid="image-size-menu"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('自动')
    expect(wrapper.text()).toContain('1K')

    await wrapper.get('[data-testid="image-custom-size-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="image-custom-size-panel"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('设置图像尺寸')
    await wrapper.get('[data-testid="custom-width"]').setValue('1280')
    await wrapper.get('[data-testid="custom-height"]').setValue('1024')

    expect(trigger.text()).toContain('1280x1024')
    expect(wrapper.get('[data-testid="custom-size-summary"]').text()).toContain('1280×1024')
  })

  it('opens the size menu upward when there is enough space above the trigger', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    const trigger = wrapper.get('[data-testid="image-size-trigger"]')
    Object.defineProperty(trigger.element, 'getBoundingClientRect', {
      value: () => ({
        top: 700,
        bottom: 740,
        left: 0,
        right: 240,
        width: 240,
        height: 40,
        x: 0,
        y: 700,
        toJSON: () => ({}),
      }),
    })

    await trigger.trigger('click')

    expect(wrapper.get('[data-testid="image-size-menu"]').classes()).toContain('is-up')
  })

  it('converges an oversized preset into the upstream pixel window', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    await wrapper.get('[data-testid="size-preset-3840-1:1"]').trigger('click')

    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('2880x2880')
    expect(wrapper.find('[data-testid="image-size-warning"]').exists()).toBe(false)
  })

  it('raises an undersized preset above the minimum pixel count', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    await wrapper.get('[data-testid="size-preset-1024-21:9"]').trigger('click')

    const match = /(\d+)x(\d+)/.exec(wrapper.get('[data-testid="image-size-trigger"]').text())
    expect(match).toBeTruthy()
    const pixels = Number(match![1]) * Number(match![2])
    expect(pixels).toBeGreaterThanOrEqual(655_360)
    expect(pixels).toBeLessThanOrEqual(8_294_400)
  })

  it('blocks a custom size beyond the pixel budget and explains why', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    await wrapper.get('[data-testid="image-custom-size-toggle"]').trigger('click')
    await wrapper.get('[data-testid="custom-width"]').setValue('3840')
    await wrapper.get('[data-testid="custom-height"]').setValue('3840')

    expect(wrapper.get('[data-testid="size-dialog-issue"]').text()).toContain('总像素')
    expect(wrapper.get('[data-testid="custom-size-summary"]').text()).toContain('14745600')
  })
})

describe('ImageStudioView inspiration handoff', () => {
  beforeEach(() => {
    resetCommonMocks()
    sessionStorage.clear()
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response))
  })

  it('hydrates a prompt handed over from the image inspiration library', async () => {
    sessionStorage.setItem(
      'sub2api:image-studio:pending-prompt',
      '清晨薄雾中的现代建筑，克制的灰蓝色调。',
    )

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('textarea').element.value).toBe('清晨薄雾中的现代建筑，克制的灰蓝色调。')
    expect(useAppStore().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'success',
        message: '已带入图片灵感提示词，选好模型和尺寸就可以生成。',
      }),
    ]))
    expect(sessionStorage.getItem('sub2api:image-studio:pending-prompt')).toBeNull()
  })
})

describe('ImageStudioView gallery', () => {
  beforeEach(() => {
    resetCommonMocks()
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    listKeys.mockResolvedValue({ items: [] })
    getPublicSettings.mockResolvedValue({ api_base_url: '' })
  })

  it('loads saved gallery images on entry', async () => {
    listGallery.mockResolvedValue([
      {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: 1,
        expires_at: 9999999999,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.text()).not.toContain('历史图片 1')
    const image = wrapper.get('img[src="https://cdn.example.com/gallery-1.png"]')
    expect(image.exists()).toBe(true)
    expect(image.attributes('loading')).toBe('lazy')
    expect(wrapper.get('article').text()).not.toContain('a cat')
  })

  it('renders gallery images in an uncropped masonry layout', async () => {
    listGallery.mockResolvedValue([
      {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        thumb_url: 'https://cdn.example.com/gallery-1-thumb.jpg',
        prompt: 'a wide room',
        model: 'gpt-image-1',
        size: '1536x1024',
        format: 'png',
        created_at: 1,
        expires_at: 9999999999,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    const masonry = wrapper.get('[data-testid="image-results-masonry"]')
    const media = masonry.get('article > button')
    const image = masonry.get('img[alt="历史图片 1"]')

    expect(media.classes()).not.toContain('aspect-square')
    expect(image.classes()).toContain('h-auto')
    expect(image.classes()).toContain('object-contain')
    expect(image.classes()).not.toContain('object-cover')
  })

  it('uses a styled delete confirmation without showing the image name', async () => {
    listGallery.mockResolvedValue([
      {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: 1,
        expires_at: 9999999999,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    await wrapper.get('[data-testid="gallery-image-delete"]').trigger('click')
    const dialog = wrapper.get('[data-testid="image-delete-confirm"]')
    expect(dialog.text()).toContain('删除后无法恢复，确定要继续吗？')
    expect(dialog.text()).not.toContain('历史图片')
    expect(dialog.text()).not.toContain('gallery-1')

    await wrapper.get('[data-testid="confirm-delete-image"]').trigger('click')
    await flushPromises()
    expect(deleteGallery).toHaveBeenCalledWith('gallery-1')
  })

  it('saves a temporary gallery image from the detail dialog', async () => {
    listGallery.mockResolvedValue([
      {
        id: 'gallery-temp',
        url: 'https://cdn.example.com/gallery-temp.png',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: false,
        created_at: 1,
        expires_at: 9999999999,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    const imageButton = wrapper.findAll('button').find((button) =>
      button.find('img[src="https://cdn.example.com/gallery-temp.png"]').exists(),
    )
    await imageButton!.trigger('click')

    const saveButton = wrapper.get('[data-testid="save-preview-to-gallery"]')
    expect(saveButton.text()).toContain('保存到我的作品')
    await saveButton.trigger('click')
    await flushPromises()

    expect(pinGallery).toHaveBeenCalledWith('gallery-temp')
    expect(wrapper.get('[data-testid="preview-saved-state"]').text()).toContain('已保存到我的作品')
    expect(wrapper.find('[data-testid="save-preview-to-gallery"]').exists()).toBe(false)
  })

  it('opens the image detail dialog and copies the original prompt', async () => {
    listGallery.mockResolvedValue([
      {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        prompt: 'a cat wearing a spacesuit',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: 1,
        expires_at: 9999999999,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    const imageButton = wrapper.findAll('button').find((button) =>
      button.find('img[src="https://cdn.example.com/gallery-1.png"]').exists(),
    )
    expect(imageButton).toBeDefined()
    await imageButton!.trigger('click')

    expect(wrapper.text()).toContain('提示词')
    expect((wrapper.get('[data-testid="edit-image-prompt"]').element as HTMLTextAreaElement).value)
      .toBe('a cat wearing a spacesuit')

    const copyButton = wrapper.findAll('button').find((button) => button.text().includes('复制'))
    expect(copyButton).toBeDefined()
    await copyButton!.trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith('a cat wearing a spacesuit', expect.any(String))
  })

  it('closes the image detail dialog from the backdrop', async () => {
    listGallery.mockResolvedValue([
      {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: 1,
        expires_at: 9999999999,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    const imageButton = wrapper.findAll('button').find((button) =>
      button.find('img[src="https://cdn.example.com/gallery-1.png"]').exists(),
    )
    await imageButton!.trigger('click')
    expect((wrapper.get('[data-testid="edit-image-prompt"]').element as HTMLTextAreaElement).value)
      .toBe('a cat')

    await wrapper.get('[data-testid="dialog-backdrop"]').trigger('click')
    expect(wrapper.find('[data-testid="edit-image-prompt"]').exists()).toBe(false)
  })

  it('saves a generated image to the seven-day gallery', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(saveGallery).toHaveBeenCalledWith(expect.objectContaining({
      image_data_url: expect.stringContaining('data:image/png;base64,'),
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
    }))
  })

  it('does not show the freshly generated image twice when the gallery lists it', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    // 首次加载图库为空，保存之后图库里就出现了这条记录
    listGallery.mockResolvedValueOnce([])
    listGallery.mockResolvedValue([
      {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: 1,
        expires_at: 2,
      },
    ])
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).not.toContain('生成结果 1')
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    // 同一张图不能既作为生成结果显示、又以「历史图片」再显示一遍
    expect(wrapper.text()).not.toContain('历史图片')
  })

  it('edits the prompt in the result dialog and regenerates with the same settings', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const generationBodies: Array<Record<string, unknown>> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        generationBodies.push(JSON.parse(String(init?.body || '{}')))
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    const imageButton = wrapper.findAll('button').find((button) =>
      button.find('img[alt="生成结果 1"]').exists(),
    )
    await imageButton!.trigger('click')

    const promptInput = wrapper.get('[data-testid="edit-image-prompt"]')
    expect((promptInput.element as HTMLTextAreaElement).value).toContain('橙色小猫')
    await promptInput.setValue('一只在雪地里的白色狐狸，电影感光线')
    await wrapper.get('[data-testid="regenerate-image-prompt"]').trigger('click')
    await flushPromises()

    expect(generationBodies).toHaveLength(2)
    expect(generationBodies[1]).toEqual(expect.objectContaining({
      prompt: '一只在雪地里的白色狐狸，电影感光线',
      model: 'gpt-image-1',
      size: '1024x1024',
      output_format: 'png',
    }))
    expect(wrapper.find('[data-testid="edit-image-prompt"]').exists()).toBe(false)
  })

  it('rewrites upstream image URLs so the enlarged image is not served from the other site', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    saveGallery.mockRejectedValue(new Error('storage unavailable'))
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ url: 'https://upstream.example.com/out.png' }] }) } as Response
      }
      if (url === 'https://upstream.example.com/out.png') {
        return {
          ok: true,
          blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        } as unknown as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    })

    const generatedImage = wrapper.get('img[alt="生成结果 1"]')
    expect(generatedImage.attributes('src')).toMatch(/^data:image\/png;base64,/)
    expect(wrapper.html()).not.toContain('upstream.example.com')
  })

  it('shows object-storage configuration errors only to admins', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    saveGallery.mockRejectedValue({
      reason: 'IMAGE_STORAGE_DISABLED',
      message: 'image storage is not enabled',
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const userWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await userWrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => {
      expect(userWrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    })
    const userAppStore = useAppStore()
    expect(userAppStore.toasts.some((toast) => toast.message.includes('图片存储未启用'))).toBe(false)
    userWrapper.unmount()

    const adminWrapper = mountImageStudio({ isAdmin: true })
    const adminAppStore = useAppStore()
    await flushPromises()
    await flushPromises()
    await adminWrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => {
      expect(adminAppStore.toasts.some((toast) => toast.message.includes('图片存储未启用'))).toBe(true)
    })
  })

  it('points the generated image at the owned storage URL after saving', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ url: 'https://upstream.example.com/out.png' }] }) } as Response
      }
      if (url === 'https://upstream.example.com/out.png') {
        return {
          ok: true,
          blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        } as unknown as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.get('img[alt="生成结果 1"]').attributes('src')).toBe('https://cdn.example.com/gallery-1.png')
    })

    expect(wrapper.get('img[alt="生成结果 1"]').attributes('src')).toBe('https://cdn.example.com/gallery-1.png')
    expect(wrapper.html()).not.toContain('upstream.example.com')
  })

  it('hands the upstream URL to the server when the browser cannot fetch it', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ url: 'https://upstream.example.com/out.png' }] }) } as Response
      }
      // 浏览器直连上游图片被 CORS 拦下
      throw new TypeError('Failed to fetch')
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    await vi.waitFor(() => {
      expect(saveGallery).toHaveBeenCalledWith(expect.objectContaining({
        image_url: 'https://upstream.example.com/out.png',
      }))
    })
    await vi.waitFor(() => {
      expect(wrapper.get('img[alt="生成结果 1"]').attributes('src')).toBe('https://cdn.example.com/gallery-1.png')
    })
  })

  it('keeps the composer editable and accepts another generation while work is in flight', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const generationBodies: Array<Record<string, unknown>> = []
    const generationResolvers: Array<(response: Response) => void> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        generationBodies.push(JSON.parse(String(init?.body || '{}')))
        return await new Promise<Response>((resolve) => { generationResolvers.push(resolve) })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('正在生成')
    expect(wrapper.text()).not.toContain('可以切换到其他页面')
    expect(wrapper.get('[data-testid="image-active-generations"]').text()).toContain('1 个任务进行中')
    expect(localStorage.getItem('sub2api:image-studio:pending')).toContain('"pending":true')
    expect(localStorage.getItem('sub2api:image-studio:pending')).toContain('"taskId"')
    expect(localStorage.getItem('sub2api:image-studio:pending')).toContain('"batchId"')

    const promptInput = wrapper.get('textarea.image-composer__prompt')
    const submitButton = wrapper.get('.image-composer__generate')
    expect(promptInput.attributes('disabled')).toBeUndefined()
    expect(submitButton.attributes('disabled')).toBeUndefined()
    expect(submitButton.text()).toContain('继续生成')

    await promptInput.setValue('第二张图片，改为暖色夕阳下的海边')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(generationResolvers).toHaveLength(2)
    expect(generationBodies[1]).toEqual(expect.objectContaining({
      prompt: '第二张图片，改为暖色夕阳下的海边',
    }))
    expect(wrapper.get('[data-testid="image-active-generations"]').text()).toContain('2 个任务进行中')

    generationResolvers[0]({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    } as Response)
    await flushPromises()

    // 第一个任务结束后，另一个任务仍在进行，工作台继续可用。
    expect(localStorage.getItem('sub2api:image-studio:pending')).not.toBeNull()
    expect(wrapper.get('.image-composer__generate').text()).toContain('继续生成')

    generationResolvers[1]({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'd29ybGQ=' }] }),
    } as Response)
    await flushPromises()

    expect(localStorage.getItem('sub2api:image-studio:pending')).toBeNull()
    expect(wrapper.text()).not.toContain('生成结果 1')
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
  })

  it('creates one pending card and one request per requested image', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const resolvers: Array<(response: Response) => void> = []
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations')) {
        return await new Promise<Response>((resolve) => resolvers.push(resolve))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(resolvers).toHaveLength(2)
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(2)

    resolvers.forEach((resolve) => {
      resolve({
        ok: true,
        json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
      } as Response)
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(wrapper.find('img[alt="生成结果 2"]').exists()).toBe(true)
  })

  it('restores pending image placeholders from browser storage on entry', async () => {
    localStorage.setItem('sub2api:image-studio:pending', JSON.stringify([
      {
        id: 55,
        title: '正在生成',
        src: '',
        meta: 'PNG · 1024x1024 · gpt-image-1',
        pending: true,
        taskId: 'imgtask_restore',
        batchId: 'batch_restore',
        prompt: '一只猫',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
      },
    ]))

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.text()).toContain('正在生成')
  })
})

describe('ImageStudioView composer controls', () => {
  beforeEach(() => {
    resetCommonMocks()
    listKeys.mockResolvedValue({ items: [] })
    getPublicSettings.mockResolvedValue({ api_base_url: '' })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('uses segmented controls for image quality in the reference order', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    const qualitySelect = wrapper.get('[data-testid="quality-select"]')
    const buttons = qualitySelect.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['自动', '高', '中', '低'])
    expect(buttons[0].classes()).toContain('is-active')

    await buttons[1].trigger('click')
    expect(buttons[1].classes()).toContain('is-active')
  })

  it('lets Gemini image models choose quality and sends the matching image size', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: 'gemini',
        key: 'sk-gemini',
        status: 'active',
        group_id: 2,
        group: { platform: 'gemini', allow_image_generation: true },
      }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let generationBody: Record<string, any> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gemini-3.1-flash-image-preview' }] }),
        } as Response
      }
      if (url.includes(':generateContent')) {
        generationBody = JSON.parse(String(init?.body || '{}'))
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }],
              },
            }],
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const qualityButtons = wrapper.get('[data-testid="quality-select"]').findAll('button')
    expect(qualityButtons[1].attributes('disabled')).toBeUndefined()
    await qualityButtons[1].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(generationBody?.generationConfig?.imageConfig).toEqual({
      aspectRatio: '1:1',
      imageSize: '4K',
    })
  })

  it('uses segmented controls for the image count', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    const countControl = wrapper.get('[data-testid="image-count-control"]')
    const input = wrapper.get('input[aria-label="生成数量"]')
    expect((input.element as HTMLInputElement).value).toBe('1')

    const buttons = countControl.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['1', '2', '3', '4'])
    await buttons[1].trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('2')

    expect(buttons[1].classes()).toContain('is-active')
  })

  it('closes the size menu when clicking outside or pressing Escape', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="image-size-menu"]').exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="image-size-menu"]').exists()).toBe(false)

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="image-size-menu"]').exists()).toBe(false)
  })

  it('restores the saved prompt height after remounting', async () => {
    localStorage.setItem('sub2api:image-studio:prompt-height', '320')
    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('textarea.image-composer__prompt').attributes('style')).toContain('height: 320px')

    wrapper.unmount()
    localStorage.removeItem('sub2api:image-studio:prompt-height')
  })
})
