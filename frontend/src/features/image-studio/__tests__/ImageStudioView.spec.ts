import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ImageStudioView from '../ImageStudioView.vue'
import { resetImageStudioDraft } from '../imageStudioDraft'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { listKeys, getPublicSettings, listGallery, saveGallery, saveGalleryFromTask, pinGallery, deleteGallery, downloadGallery, thumbnailGallery, galleryQuota, copyToClipboard, imageNeedsLocalResize, processImageForDisplay, tryStartPersistent, waitForPersistent } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  getPublicSettings: vi.fn(),
  listGallery: vi.fn(),
  saveGallery: vi.fn(),
  saveGalleryFromTask: vi.fn(),
  pinGallery: vi.fn(),
  deleteGallery: vi.fn(),
  downloadGallery: vi.fn(),
  thumbnailGallery: vi.fn(),
  galleryQuota: vi.fn(),
  copyToClipboard: vi.fn(),
  imageNeedsLocalResize: vi.fn(),
  processImageForDisplay: vi.fn(),
  tryStartPersistent: vi.fn(),
  waitForPersistent: vi.fn(),
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
    saveFromTask: saveGalleryFromTask,
    pin: pinGallery,
    delete: deleteGallery,
    download: downloadGallery,
    thumbnail: thumbnailGallery,
    quota: galleryQuota,
  },
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard,
  }),
}))

vi.mock('../imagePostProcess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../imagePostProcess')>()
  return {
    ...actual,
    imageNeedsLocalResize,
    processImageForDisplay,
  }
})

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

vi.mock('@/utils/imageGenerationWorker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/imageGenerationWorker')>()
  return {
    ...actual,
    tryStartPersistentImageGeneration: tryStartPersistent,
    waitForPersistentImageGeneration: waitForPersistent,
  }
})

const componentPath = resolve(dirname(fileURLToPath(import.meta.url)), '../ImageStudioView.vue')
const componentSource = readFileSync(componentPath, 'utf8')

function imageStudioPendingStorageKey(userId = 2) {
  return `sub2api:image-studio:pending:${userId}`
}

const mountedWrappers = new Set<VueWrapper<any>>()

function mountImageStudio(options: { isAdmin?: boolean; userId?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const authStore = useAuthStore(pinia)
  authStore.user = {
    id: options.userId ?? (options.isAdmin ? 1 : 2),
    email: options.isAdmin ? 'admin@example.com' : 'user@example.com',
    role: options.isAdmin ? 'admin' : 'user',
  } as any
  const wrapper = mount(ImageStudioView, {
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
  mountedWrappers.add(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mountedWrappers) {
    try {
      wrapper.unmount()
    } catch {
      // Some tests explicitly unmount the wrapper.
    }
  }
  mountedWrappers.clear()
})

function resetCommonMocks() {
  resetImageStudioDraft()
  sessionStorage.clear()
  listKeys.mockReset()
  getPublicSettings.mockReset()
  listGallery.mockReset()
  saveGallery.mockReset()
  saveGalleryFromTask.mockReset()
  pinGallery.mockReset()
  deleteGallery.mockReset()
  downloadGallery.mockReset()
  thumbnailGallery.mockReset()
  galleryQuota.mockReset()
  copyToClipboard.mockReset()
  imageNeedsLocalResize.mockReset()
  processImageForDisplay.mockReset()
  tryStartPersistent.mockReset()
  waitForPersistent.mockReset()
  tryStartPersistent.mockResolvedValue(false)
  waitForPersistent.mockRejectedValue(new Error('Persistent image generation is unavailable'))
  listGallery.mockResolvedValue([])
  pinGallery.mockResolvedValue(undefined)
  deleteGallery.mockResolvedValue(undefined)
  downloadGallery.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  thumbnailGallery.mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))
  galleryQuota.mockResolvedValue({ used: 0, limit: 100 })
  copyToClipboard.mockResolvedValue(true)
  imageNeedsLocalResize.mockImplementation((value: string, upstreamMaxEdge: number) => {
    const match = /^(\d+)x(\d+)$/i.exec(value.trim())
    if (!match) return false
    return Number(match[1]) > upstreamMaxEdge || Number(match[2]) > upstreamMaxEdge
  })
  processImageForDisplay.mockImplementation(async (src: string, _targetSize: string, format: string) => ({
    src,
    format,
    processed: false,
  }))
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
  saveGalleryFromTask.mockResolvedValue({
    id: 'gallery-task-1',
    url: 'https://cdn.example.com/gallery-task-1.png',
    prompt: '',
    model: '',
    size: '',
    format: '',
    created_at: 0,
    expires_at: 0,
  })
}

function asyncImageUnavailableResponse(): Response {
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({ error: { message: 'async image tasks are not enabled' } }),
  } as Response
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
              { id: 'gemini-nano-banana-2.1' },
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
    expect(modelSelect.text()).toContain('gemini-nano-banana-2.1')
    expect(modelSelect.classes()).toContain('studio-select--down')
    expect(modelSelect.text()).toContain('gemini-nano-banana-2.1')
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

  it('restores the last selected API key and image model after remount', async () => {
    localStorage.clear()
    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: 'first-key', key: 'sk-first', status: 'active', group_id: 2 },
        { id: 2, name: 'second-key', key: 'sk-second', status: 'active', group_id: 2 },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gpt-image-1' }, { id: 'gpt-image-2' }] }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const firstWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const firstKeySelect = firstWrapper.get('[data-testid="api-key-select"]')
    await firstKeySelect.get('button').trigger('click')
    const secondKeyOption = firstKeySelect.findAll('button')
      .find((button) => button.text().includes('second-key'))
    expect(secondKeyOption).toBeDefined()
    await secondKeyOption!.trigger('click')
    await flushPromises()
    await flushPromises()

    const firstModelSelect = firstWrapper.get('[data-testid="image-model-select"]')
    await firstModelSelect.get('button').trigger('click')
    const secondModelOption = firstModelSelect.findAll('button')
      .find((button) => button.text().includes('gpt-image-2'))
    expect(secondModelOption).toBeDefined()
    await secondModelOption!.trigger('click')
    await flushPromises()

    firstWrapper.unmount()

    const secondWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(secondWrapper.get('[data-testid="api-key-select"]').text()).toContain('second-key')
    expect(secondWrapper.get('[data-testid="image-model-select"]').text()).toContain('gpt-image-2')
  })

  it('lets users choose an image output format and sends it upstream', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let generationBody: Record<string, any> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        generationBody = JSON.parse(String(init?.body || '{}'))
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const formatControl = wrapper.get('[data-testid="image-format-control"]')
    const formatButtons = formatControl.findAll('button')
    expect(formatButtons.map((button) => button.text())).toEqual(['PNG', 'JPEG', 'WEBP'])
    expect(formatButtons[0].classes()).toContain('is-active')

    await formatButtons[2].trigger('click')
    expect(formatButtons[2].classes()).toContain('is-active')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(generationBody).toEqual(expect.objectContaining({
      output_format: 'webp',
    }))
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
    const galleryCallsBefore = listGallery.mock.calls.length
    expect(modelCallsBefore).toBeGreaterThan(0)

    await wrapper.get('[data-testid="image-refresh"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(listKeys.mock.calls.length).toBeGreaterThan(keyCallsBefore)
    expect(listGallery.mock.calls.length).toBe(galleryCallsBefore)
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

  it('offers complete GPT Image tiers and aspect ratios', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')

    const menuText = wrapper.get('[data-testid="image-size-menu"]').text()
    expect(menuText).toContain('默认')
    expect(menuText).toContain('2K')
    expect(menuText).toContain('4K')
    expect(menuText).toContain('1:1 1024x1024')
    expect(menuText).toContain('3:2 1536x1024')
    expect(menuText).toContain('2:3 1024x1536')
    expect(menuText).toContain('4:3 1408x1056')
    expect(menuText).toContain('3:4 1056x1408')
    expect(menuText).toContain('4:5 1024x1280')
    expect(menuText).toContain('5:4 1280x1024')
    expect(menuText).toContain('16:9 1536x864')
    expect(menuText).toContain('21:9 1792x768')

    await wrapper.get('[data-testid="size-preset-1024-3:2"]').trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('3:2 1536x1024')

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    await wrapper.get('[data-testid="size-preset-2048-3:4"]').trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('3:4 2112x2816')

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    await wrapper.get('[data-testid="size-preset-3840-4:3"]').trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('4:3 3312x2480')
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

  it('allows Gemini custom output up to 4096 for local processing', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gemini-3.1-flash-image-preview' }] }),
        } as Response
      }
      if (url.endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gemini-3.1-flash-image-preview' }] }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="image-model-select"]').text())
        .toContain('gemini-3.1-flash-image-preview')
      expect(wrapper.get('button.image-composer__generate').attributes('disabled')).toBeUndefined()
    })
    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    await wrapper.get('[data-testid="image-custom-size-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="custom-width"]').attributes('max')).toBe('4096')
    expect(wrapper.get('[data-testid="custom-height"]').attributes('max')).toBe('4096')
    await wrapper.get('[data-testid="custom-width"]').setValue('4096')
    await wrapper.get('[data-testid="custom-height"]').setValue('4096')

    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('4096x4096')
    expect(wrapper.find('[data-testid="size-dialog-issue"]').exists()).toBe(false)
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
      'sub2api:image-studio:pending-prompt:2',
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
    expect(sessionStorage.getItem('sub2api:image-studio:pending-prompt:2')).toBeNull()
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
        duration_ms: 1234,
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

  it('renders the cached gallery immediately when remounting', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-image-1' }] }),
    } as Response)
    listGallery.mockResolvedValue([{
      id: 'gallery-1',
      url: 'https://cdn.example.com/gallery-1.png',
      thumb_url: 'https://cdn.example.com/gallery-1-thumb.jpg',
      prompt: 'a room',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const firstWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    expect(firstWrapper.find('img[src="https://cdn.example.com/gallery-1-thumb.jpg"]').exists()).toBe(true)
    await vi.waitFor(() => {
      expect(firstWrapper.find('img[src="data:image/jpeg;base64,dGh1bWI="]').exists()).toBe(true)
    })
    firstWrapper.unmount()

    listGallery.mockReturnValue(new Promise(() => {}))
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    const secondWrapper = mountImageStudio()

    expect(secondWrapper.find('img[src="data:image/jpeg;base64,dGh1bWI="]').exists()).toBe(true)
    await vi.waitFor(() => {
      expect(secondWrapper.get('[data-testid="api-key-select"]').text()).toContain('dd')
    })
    expect(secondWrapper.get('[data-testid="image-model-select"]').text()).toContain('gpt-image-1')
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/v1/images/batches/models', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-local' }),
      }))
    })
    expect(secondWrapper.find('.toolbar-error').exists()).toBe(false)
  })

  it('does not show a key error while cached credentials are still loading', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-image-1' }] }),
    } as Response)

    const firstWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    firstWrapper.unmount()

    listKeys.mockReturnValue(new Promise(() => {}))
    const secondWrapper = mountImageStudio()
    await flushPromises()

    expect(secondWrapper.get('[data-testid="api-key-select"]').text()).toContain('dd')
    expect(secondWrapper.find('.toolbar-error').exists()).toBe(false)
  })

  it('does not expose one user image snapshot to another user', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-image-1' }] }),
    } as Response)
    listGallery.mockResolvedValue([{
      id: 'gallery-user-101',
      url: 'https://cdn.example.com/user-101-private.png',
      prompt: 'private prompt',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const firstWrapper = mountImageStudio({ userId: 101 })
    await flushPromises()
    await flushPromises()
    expect(firstWrapper.find('img[src="https://cdn.example.com/user-101-private.png"]').exists()).toBe(true)
    firstWrapper.unmount()

    listGallery.mockReturnValue(new Promise(() => {}))
    const secondWrapper = mountImageStudio({ userId: 102 })
    expect(secondWrapper.find('img[src="https://cdn.example.com/user-101-private.png"]').exists()).toBe(false)
  })

  it('clears the current gallery immediately when the authenticated user changes', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    listGallery.mockResolvedValueOnce([{
      id: 'gallery-user-101',
      url: 'https://cdn.example.com/user-101-private.png',
      prompt: 'first user',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const wrapper = mountImageStudio({ userId: 101 })
    await flushPromises()
    expect(wrapper.find('img[src="https://cdn.example.com/user-101-private.png"]').exists()).toBe(true)

    const authStore = useAuthStore()
    authStore.user = null
    await flushPromises()
    expect(wrapper.find('img[src="https://cdn.example.com/user-101-private.png"]').exists()).toBe(false)

    let resolveSecondUser: (value: any[]) => void = () => undefined
    listGallery.mockReturnValueOnce(new Promise((resolve) => {
      resolveSecondUser = resolve
    }))
    authStore.user = {
      id: 102,
      email: 'second@example.com',
      role: 'user',
    } as any
    await flushPromises()

    expect(wrapper.find('img[src="https://cdn.example.com/user-101-private.png"]').exists()).toBe(false)

    resolveSecondUser([{
      id: 'gallery-user-102',
      url: 'https://cdn.example.com/user-102-private.png',
      prompt: 'second user',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 2,
      expires_at: 9999999999,
    }])
    await flushPromises()
    expect(wrapper.find('img[src="https://cdn.example.com/user-102-private.png"]').exists()).toBe(true)
  })

  it('ignores a previous user gallery response that resolves after logout', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let resolveFirstUser: (value: any[]) => void = () => undefined
    let resolveSecondUser: (value: any[]) => void = () => undefined
    listGallery
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstUser = resolve
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecondUser = resolve
      }))

    const wrapper = mountImageStudio({ userId: 101 })
    await flushPromises()
    const authStore = useAuthStore()
    authStore.user = null
    await flushPromises()
    authStore.user = {
      id: 102,
      email: 'second@example.com',
      role: 'user',
    } as any
    await flushPromises()

    resolveFirstUser([{
      id: 'gallery-stale-user-101',
      url: 'https://cdn.example.com/stale-user-101.png',
      prompt: 'stale',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])
    await flushPromises()
    expect(wrapper.find('img[src="https://cdn.example.com/stale-user-101.png"]').exists()).toBe(false)

    resolveSecondUser([{
      id: 'gallery-user-102',
      url: 'https://cdn.example.com/user-102-fresh.png',
      prompt: 'fresh',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 2,
      expires_at: 9999999999,
    }])
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.find('img[src="https://cdn.example.com/user-102-fresh.png"]').exists()).toBe(true)
    })
  })

  it('replaces a cached generated image with its server gallery entry after remount', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let phase = 1
    const galleryEntry = {
      id: 'gallery-1',
      url: 'https://cdn.example.com/gallery-1.png',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      saved: false,
      created_at: 2,
      expires_at: 9999999999,
    }
    listGallery.mockImplementation(async () => phase === 1 ? [] : [galleryEntry])
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    saveGallery.mockResolvedValue(galleryEntry)

    const firstWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await firstWrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()
    firstWrapper.unmount()

    phase = 2
    const secondWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(secondWrapper.findAll('img[src="https://cdn.example.com/gallery-1.png"]')).toHaveLength(1)
  })

  it('continues numeric image ids after restoring a snapshot', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let syncGenerationCalls = 0
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        syncGenerationCalls += 1
        if (syncGenerationCalls === 1) {
          return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
        }
        return await new Promise<Response>(() => {})
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const firstWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await firstWrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()
    firstWrapper.unmount()

    listGallery.mockReturnValue(new Promise(() => {}))
    const secondWrapper = mountImageStudio()
    await flushPromises()
    await secondWrapper.get('form').trigger('submit')
    await flushPromises()

    const pending = JSON.parse(localStorage.getItem(imageStudioPendingStorageKey()) || '[]')
    expect(pending).toHaveLength(1)
    expect(Number(pending[0].id)).toBeGreaterThan(1)
  })

  it('renders gallery images in a uniform grid', async () => {
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

    const grid = wrapper.get('[data-testid="image-results-grid"]')
    const media = grid.get('article > button')
    const image = grid.get('img[alt="历史图片 1"]')

    expect(media.classes()).not.toContain('aspect-square')
    expect(image.classes()).toContain('h-full')
    expect(image.classes()).toContain('object-cover')
    expect(image.classes()).not.toContain('object-contain')
    expect(componentSource).toContain('aspect-ratio: 16 / 10')
    expect(thumbnailGallery).toHaveBeenCalledWith('gallery-1')

    await media.trigger('click')
    await flushPromises()
    expect(wrapper.get('.image-detail-dialog__media img').attributes('src')).toBe(
      'https://cdn.example.com/gallery-1-thumb.jpg',
    )
  })

  it('keeps gallery images in flat display order', async () => {
    listGallery.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `gallery-${index + 1}`,
        url: `https://cdn.example.com/gallery-${index + 1}.png`,
        prompt: `image ${index + 1}`,
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: index + 1,
        expires_at: 9999999999,
      })),
    )

    const wrapper = mountImageStudio()
    await flushPromises()

    const grid = wrapper.get('[data-testid="image-results-grid"]')
    expect(grid.findAll('article img').map((image) => image.attributes('alt'))).toEqual([
      '历史图片 1',
      '历史图片 2',
      '历史图片 3',
      '历史图片 4',
    ])
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
        duration_ms: 1234,
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
        duration_ms: 1234,
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
    expect(wrapper.get('[data-testid="image-generation-duration"]').text()).toBe('1 秒')
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
      duration_ms: expect.any(Number),
    }))
  })

  it('does not persist an in-flight generation after the authenticated user changes', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let resolveGeneration: (response: Response) => void = () => undefined
    const generationResponse = new Promise<Response>((resolve) => {
      resolveGeneration = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) return generationResponse
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio({ userId: 101 })
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const authStore = useAuthStore()
    authStore.user = null
    await flushPromises()
    authStore.user = {
      id: 102,
      email: 'second@example.com',
      role: 'user',
    } as any
    await flushPromises()

    resolveGeneration({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'b2xkLXVzZXItaW1hZ2U=' }] }),
    } as Response)
    await flushPromises()
    await flushPromises()

    expect(saveGallery).not.toHaveBeenCalled()
    expect(wrapper.findAll('img[alt^="生成结果"]')).toHaveLength(0)
  })

  it('shows an explicit timeout failure when a sync image request exceeds four minutes', async () => {
    vi.useFakeTimers()
    try {
      listKeys.mockResolvedValue({
        items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
      })
      getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/images/batches/models')) {
          return { ok: true, json: async () => ({ data: [] }) } as Response
        }
        if (url.endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
        }
        if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
        if (url.endsWith('/images/generations')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            }, { once: true })
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      })

      const wrapper = mountImageStudio()
      await flushPromises()
      await flushPromises()
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 1_000)
      await flushPromises()

      expect(wrapper.get('[data-testid="image-generation-failure"]').text()).toContain('请求超时')
      expect(wrapper.get('[data-testid="image-generation-failure"]').text()).toContain('4 分钟')
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists each generated image with its own completion time and duration', async () => {
    const baseTime = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(baseTime)
    try {
      listKeys.mockResolvedValue({
        items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
      })
      getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
      let submitCalls = 0
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/images/batches/models')) {
          return { ok: true, json: async () => ({ data: [] }) } as Response
        }
        if (url.endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
        }
        if (url.endsWith('/images/generations/async')) {
          submitCalls += 1
          return {
            ok: true,
            status: 202,
            json: async () => ({
              task_id: `imgtask_timed_${submitCalls}`,
              status: 'processing',
              poll_url: `/v1/images/tasks/imgtask_timed_${submitCalls}`,
            }),
          } as Response
        }
        if (url.endsWith('/images/tasks/imgtask_timed_1')) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_timed_1',
              status: 'completed',
              result: { data: [{ b64_json: 'Zmlyc3Q=', mime_type: 'image/png' }] },
            }),
          } as Response
        }
        if (url.endsWith('/images/tasks/imgtask_timed_2')) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000))
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_timed_2',
              status: 'completed',
              result: { data: [{ b64_json: 'c2Vjb25k', mime_type: 'image/png' }] },
            }),
          } as Response
        }
        throw new Error(`Unexpected request: ${url}`)
      })

      const wrapper = mountImageStudio()
      await flushPromises()
      await flushPromises()
      await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
      await wrapper.get('form').trigger('submit')
      await vi.advanceTimersByTimeAsync(3000)
      await flushPromises()

      expect(saveGalleryFromTask).toHaveBeenCalledTimes(2)
      const payloads = saveGalleryFromTask.mock.calls.map(([payload]) => payload)
      expect(payloads.map((payload) => payload.created_at)).toEqual([
        baseTime / 1000 + 1,
        baseTime / 1000 + 3,
      ])
      expect(payloads.map((payload) => payload.duration_ms)).toEqual([1000, 3000])
      expect(payloads.map((payload) => payload.task_id)).toEqual([
        'imgtask_timed_1',
        'imgtask_timed_2',
      ])
      expect(saveGallery).not.toHaveBeenCalled()
      expect(listGallery).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows each image as soon as its own task completes', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let submitCalls = 0
    let resolveFirst!: (response: Response) => void
    let resolveSecond!: (response: Response) => void
    const firstPoll = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const secondPoll = new Promise<Response>((resolve) => {
      resolveSecond = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        submitCalls += 1
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: `imgtask_progressive_${submitCalls}`,
            status: 'processing',
            poll_url: `/v1/images/tasks/imgtask_progressive_${submitCalls}`,
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_progressive_1')) return firstPoll
      if (url.endsWith('/images/tasks/imgtask_progressive_2')) return secondPoll
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(2)

    resolveFirst({
      ok: true,
      json: async () => ({
        task_id: 'imgtask_progressive_1',
        status: 'completed',
        result: { data: [{ b64_json: 'Zmlyc3Q=', mime_type: 'image/png' }] },
      }),
    } as Response)
    await flushPromises()

    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(1)

    resolveSecond({
      ok: true,
      json: async () => ({
        task_id: 'imgtask_progressive_2',
        status: 'completed',
        result: { data: [{ b64_json: 'c2Vjb25k', mime_type: 'image/png' }] },
      }),
    } as Response)
    await flushPromises()
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
  })

  it('keeps failed generations visible and restores them from user history', async () => {
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
      if (url.endsWith('/images/generations/async')) {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({
            error: {
              message: 'The request was rejected by the safety system.',
            },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="image-generation-failure"]').text())
      .toContain('The request was rejected by the safety system.')
    expect(wrapper.get('[data-testid="image-generation-failure"]').text())
      .toContain('HTTP 403')
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
    const stored = JSON.parse(localStorage.getItem('sub2api:image-studio:failures:2') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].error).toContain('The request was rejected by the safety system.')
    await wrapper.get('.studio-results__action').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(true)

    wrapper.unmount()
    const restoredWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(restoredWrapper.get('[data-testid="image-generation-failure"]').text())
      .toContain('The request was rejected by the safety system.')
    await restoredWrapper.get('button[title="删除失败记录"]').trigger('click')
    expect(restoredWrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)
    expect(localStorage.getItem('sub2api:image-studio:failures:2')).toBeNull()
    restoredWrapper.unmount()
  })

  it('shows non-upstream task protocol errors as removable failure cards', async () => {
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
      if (url.endsWith('/images/generations/async')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({}),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="image-generation-failure"]').text())
      .toContain('服务端没有返回图片任务地址')
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
    await wrapper.get('button[title="删除失败记录"]').trigger('click')
    expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a ready preview before the original image has been persisted', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let pollCalls = 0
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: 'imgtask_preview_ready',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_preview_ready',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_preview_ready')) {
        pollCalls += 1
        if (pollCalls === 1) {
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_preview_ready',
              status: 'preview_ready',
              result: { data: [{ url: 'data:image/jpeg;base64,cHJldmlldw==' }] },
            }),
          } as Response
        }
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_preview_ready',
            status: 'completed',
            result: { data: [{ b64_json: 'ZmluYWw=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.find('.image-pending-card--preview img').attributes('src')).toBe('data:image/jpeg;base64,cHJldmlldw==')
    }, { timeout: 2000, interval: 50 })
    expect(wrapper.find('.image-pending-card__preview-status').text()).toContain('预览已生成')
    expect(saveGalleryFromTask).not.toHaveBeenCalled()

    await vi.waitFor(() => {
      expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
    }, { timeout: 2000, interval: 50 })
    expect(saveGalleryFromTask).toHaveBeenCalledWith(expect.objectContaining({
      task_id: 'imgtask_preview_ready',
    }))
  })

  it('does not process a persistent image result twice', async () => {
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      throw new Error(`Unexpected request: ${url}`)
    })
    tryStartPersistent.mockResolvedValue(true)
    waitForPersistent.mockImplementation(async (ids: string[], options: {
      onResponse?: (id: string, response: {
        ok: boolean
        status: number
        statusText: string
        body: string
        startedAt?: number
        completedAt?: number
      }) => void | Promise<void>
    }) => {
      const responses = ids.map((id, index) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: JSON.stringify({
          data: [{ b64_json: index === 0 ? 'Zmlyc3Q=' : 'c2Vjb25k', mime_type: 'image/png' }],
        }),
        startedAt: Date.now(),
        completedAt: Date.now() + index,
      }))
      for (let index = 0; index < ids.length; index += 1) {
        await options.onResponse?.(ids[index], responses[index])
      }
      return responses
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(wrapper.findAll('.image-result-card__media img')).toHaveLength(2)
    expect(saveGallery).toHaveBeenCalledTimes(2)
  })

  it('uses the server-side image task and polls it until the result is complete', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: 'imgtask_server',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_server',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_server')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_server',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/images/generations/async',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/images/tasks/imgtask_server'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-local' }) }),
    )
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toBeNull()
    expect(saveGalleryFromTask).toHaveBeenCalledWith(expect.objectContaining({
      task_id: 'imgtask_server',
      image_index: 0,
      saved: false,
    }))
    expect(saveGallery).not.toHaveBeenCalled()

    const generatedButton = wrapper.findAll('button').find((button) =>
      button.find('img[alt="生成结果 1"]').exists(),
    )
    await generatedButton!.trigger('click')
    expect(wrapper.get('[data-testid="image-generation-duration"]').text()).toMatch(/^\d+ 秒$|^\d+ 分 \d+ 秒$/)
  })

  it('uses a completed async image URL directly without downloading and redrawing it', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: 'imgtask_server_url',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_server_url',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_server_url')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_server_url',
            status: 'completed',
            result: {
              data: [{
                url: 'https://cdn.example.com/generated.png',
                mime_type: 'image/png',
              }],
            },
          }),
        } as Response
      }
      if (url === 'https://cdn.example.com/generated.png') {
        return {
          ok: true,
          blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalledWith('https://cdn.example.com/generated.png')
  })

  it('keeps already submitted async tasks when a later submission loses the network', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 7, name: 'original', key: 'sk-original', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let submitCalls = 0
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        submitCalls += 1
        if (submitCalls >= 2) throw new TypeError('Failed to fetch')
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: 'imgtask_partial',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_partial',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_partial')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_partial',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 600))
    await flushPromises()

    expect(submitCalls).toBe(3)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/images/tasks/imgtask_partial'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-original' }) }),
    )
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toBeNull()
  })

  it('shows the first async image before a slower sibling task finishes', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let submitCalls = 0
    let resolveSlowPoll!: (response: Response) => void
    const slowPoll = new Promise<Response>((resolve) => {
      resolveSlowPoll = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        submitCalls += 1
        const taskID = submitCalls === 1 ? 'imgtask_fast' : 'imgtask_slow'
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: taskID,
            status: 'processing',
            poll_url: `/v1/images/tasks/${taskID}`,
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_fast')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_fast',
            status: 'completed',
            result: { data: [{ b64_json: 'ZmFzdA==', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_slow')) return slowPoll
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
    const submitPromise = wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain('正在生成')
    expect(wrapper.findAll('img[alt^="生成结果"]')).toHaveLength(1)

    resolveSlowPoll({
      ok: true,
      json: async () => ({
        task_id: 'imgtask_slow',
        status: 'completed',
        result: { data: [{ b64_json: 'c2xvdw==', mime_type: 'image/png' }] },
      }),
    } as Response)
    await submitPromise
    await flushPromises()

    expect(wrapper.findAll('img[alt^="生成结果"]')).toHaveLength(2)
  })

  it('does not fall back to sync generation after an ambiguous async submission', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let asyncCalls = 0
    let syncCalls = 0
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) {
        asyncCalls += 1
        if (asyncCalls === 1) throw new TypeError('Failed to fetch')
        return asyncImageUnavailableResponse()
      }
      if (url.endsWith('/images/generations')) {
        syncCalls += 1
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 600))
    await flushPromises()

    expect(asyncCalls).toBe(2)
    expect(syncCalls).toBe(0)
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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

  it('loads a thumbnail for a freshly generated image using its gallery id mapping', async () => {
    const originalCreateObjectURL = URL.createObjectURL
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:gallery-thumb'),
    })
    try {
      listKeys.mockResolvedValue({
        items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
      })
      getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
      const galleryEntry = {
        id: 'gallery-1',
        url: 'https://cdn.example.com/gallery-1.png',
        thumb_url: '',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: false,
        created_at: 1,
        expires_at: 9999999999,
      }
      listGallery.mockResolvedValueOnce([]).mockResolvedValue([galleryEntry])
      saveGallery.mockResolvedValue(galleryEntry)
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/images/batches/models')) {
          return { ok: true, json: async () => ({ data: [] }) } as Response
        }
        if (url.endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
        }
        if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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

      expect(thumbnailGallery).toHaveBeenCalledWith('gallery-1')
      await vi.waitFor(() => {
        expect(wrapper.get('img[alt="生成结果 1"]').attributes('src')).toBe(
          'data:image/jpeg;base64,dGh1bWI=',
        )
      })
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      })
    }
  })

  it('applies a refreshed gallery thumbnail URL to the local generated card', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const savedEntry = {
      id: 'gallery-1',
      url: 'https://cdn.example.com/gallery-1.png',
      thumb_url: '',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      saved: false,
      created_at: 1,
      expires_at: 9999999999,
    }
    const refreshedEntry = {
      ...savedEntry,
      thumb_url: 'https://cdn.example.com/gallery-1-thumb.jpg',
    }
    listGallery.mockResolvedValueOnce([]).mockResolvedValue([refreshedEntry])
    saveGallery.mockResolvedValue(savedEntry)
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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

    expect(wrapper.get('img[alt="生成结果 1"]').attributes('src')).toBe('https://cdn.example.com/gallery-1-thumb.jpg')
    expect(thumbnailGallery).toHaveBeenCalledWith('gallery-1')
  })

  it('keeps an inline preview as the immediate card source after saving', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const savedEntry = {
      id: 'gallery-inline-preview',
      url: 'https://cdn.example.com/gallery-inline.png',
      thumb_url: 'https://cdn.example.com/gallery-inline-thumb.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      saved: false,
      created_at: 1,
      expires_at: 9999999999,
    }
    listGallery.mockResolvedValueOnce([]).mockResolvedValue([savedEntry])
    saveGallery.mockResolvedValue(savedEntry)
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              b64_json: 'aGVsbG8=',
              preview_data_url: 'data:image/jpeg;base64,cHJldmlldw==',
            }],
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(wrapper.get('img[alt="生成结果 1"]').attributes('src')).toBe(
      'data:image/jpeg;base64,cHJldmlldw==',
    )
  })

  it('shows image loading and failure states instead of a blank card', async () => {
    listGallery.mockResolvedValue([{
      id: 'gallery-broken',
      url: 'https://cdn.example.com/broken.png',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.find('[data-testid="image-media-loading"]').exists()).toBe(true)
    await wrapper.get('img[alt="历史图片 1"]').trigger('error')
    expect(wrapper.get('[data-testid="image-media-error"]').text()).toContain('图片加载失败')
  })

  it('removes loading overlays after the card and preview image load', async () => {
    listGallery.mockResolvedValue([{
      id: 'gallery-loading',
      url: 'https://cdn.example.com/loading.png',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const wrapper = mountImageStudio()
    await flushPromises()

    const card = wrapper.get('[data-testid="image-results-grid"] article > button')
    expect(wrapper.find('[data-testid="image-media-loading"]').exists()).toBe(true)
    await card.trigger('click')
    expect(wrapper.find('[data-testid="preview-image-loading"]').exists()).toBe(true)

    await wrapper.get('.image-detail-dialog__media img').trigger('load')

    expect(wrapper.find('[data-testid="preview-image-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="image-media-loading"]').exists()).toBe(false)
  })

  it('falls back to the original image when a thumbnail fails', async () => {
    listGallery.mockResolvedValue([{
      id: 'gallery-fallback',
      url: 'https://cdn.example.com/original.png',
      thumb_url: 'https://cdn.example.com/broken-thumb.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const wrapper = mountImageStudio()
    await flushPromises()

    await wrapper.get('img[alt="历史图片 1"]').trigger('error')
    await flushPromises()

    expect(wrapper.get('img[alt="历史图片 1"]').attributes('src')).toBe('https://cdn.example.com/original.png')
    expect(wrapper.find('[data-testid="image-media-error"]').exists()).toBe(false)
  })

  it('marks a media card failed after both thumbnail and original time out', async () => {
    vi.useFakeTimers()
    thumbnailGallery.mockRejectedValueOnce(new Error('thumbnail unavailable'))
    listGallery.mockResolvedValue([{
      id: 'gallery-slow',
      url: 'https://cdn.example.com/slow-original.png',
      thumb_url: 'https://cdn.example.com/slow-thumb.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])
    const wrapper = mountImageStudio()
    try {
      await flushPromises()
      expect(wrapper.find('[data-testid="image-media-loading"]').exists()).toBe(true)

      await vi.advanceTimersByTimeAsync(15_000)
      await flushPromises()
      expect(wrapper.get('img[alt="历史图片 1"]').attributes('src')).toBe(
        'https://cdn.example.com/slow-original.png',
      )

      await vi.advanceTimersByTimeAsync(15_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="image-media-error"]').exists()).toBe(true)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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

  it('displays upstream image URLs immediately without downloading them locally', async () => {
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
    expect(generatedImage.attributes('src')).toBe('https://upstream.example.com/out.png')
    expect(fetch).not.toHaveBeenCalledWith('https://upstream.example.com/out.png')
  })

  it('keeps the pending card visible until required local resizing finishes', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    saveGallery.mockRejectedValue(new Error('storage unavailable'))
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gemini-3.1-flash-image-preview' }] }),
        } as Response
      }
      if (url.endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gemini-3.1-flash-image-preview' }] }),
        } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: 'c291cmNl', mime_type: 'image/png' }] }),
        } as Response
      }
      if (url.includes('/v1beta/models/gemini-3.1-flash-image-preview:generateContent')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  inlineData: { mimeType: 'image/png', data: 'c291cmNl' },
                }],
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
    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    await wrapper.get('[data-testid="image-custom-size-toggle"]').trigger('click')
    await wrapper.get('[data-testid="custom-width"]').setValue('4096')
    await wrapper.get('[data-testid="custom-height"]').setValue('4096')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('4096x4096')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).not.toBe('')
    expect(wrapper.get('button.image-composer__generate').attributes('disabled')).toBeUndefined()

    let resolveProcess!: (value: {
      src: string
      format: string
      processed: boolean
    }) => void
    processImageForDisplay.mockImplementation(() => new Promise((resolve) => {
      resolveProcess = resolve
    }))

    const submitPromise = wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(imageNeedsLocalResize).toHaveBeenCalled()
      expect(imageNeedsLocalResize).toHaveBeenCalledWith('4096x4096', 3840)
      expect(processImageForDisplay).toHaveBeenCalledWith(
        expect.stringContaining('data:image/png;base64,'),
        '4096x4096',
        'png',
      )
    })
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('正在生成')

    resolveProcess({
      src: 'data:image/png;base64,processed',
      format: 'png',
      processed: true,
    })
    await submitPromise
    await flushPromises()

    expect(wrapper.get('img[alt="生成结果 1"]').attributes('src'))
      .toBe('data:image/png;base64,processed')
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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

  it('does not show the async fallback warning after a 404 response', async () => {
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio({ isAdmin: true })
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    await vi.waitFor(() => {
      expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    })
    expect(useAppStore().toasts.some((toast) => (
      toast.message.includes('异步生图未生效')
      || toast.message.includes('检查异步生图对象存储')
    ))).toBe(false)
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toContain('"pending":true')
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toContain('"taskId"')
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toContain('"batchId"')

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
    expect(localStorage.getItem(imageStudioPendingStorageKey())).not.toBeNull()
    expect(wrapper.get('.image-composer__generate').text()).toContain('继续生成')

    generationResolvers[1]({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'd29ybGQ=' }] }),
    } as Response)
    await flushPromises()

    expect(localStorage.getItem(imageStudioPendingStorageKey())).toBeNull()
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
    expect(wrapper.get('[data-testid="image-active-generations"]').text()).toContain('2 个任务进行中')

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

  it('shows elapsed seconds while generating and removes them when finished', async () => {
    vi.useFakeTimers()
    try {
      listKeys.mockResolvedValue({
        items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
      })
      getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
      let resolveGeneration: (response: Response) => void = () => {}
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/images/batches/models')) {
          return { ok: true, json: async () => ({ data: [] }) } as Response
        }
        if (url.endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
        }
        if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
        if (url.endsWith('/images/generations')) {
          return await new Promise<Response>((resolve) => {
            resolveGeneration = resolve
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      })

      const wrapper = mountImageStudio()
      await flushPromises()
      await flushPromises()
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('[data-testid="image-active-generations"]').text()).toContain('1 个任务进行中')
      expect(wrapper.get('[data-testid="image-pending-timer"]').text()).toBe('0 秒')

      await vi.advanceTimersByTimeAsync(2100)
      await flushPromises()

      expect(wrapper.get('[data-testid="image-active-generations"]').text()).toContain('1 个任务进行中')
      expect(wrapper.get('[data-testid="image-pending-timer"]').text()).toBe('2 秒')

      resolveGeneration({
        ok: true,
        json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
      } as Response)
      await flushPromises()

      expect(wrapper.find('[data-testid="image-pending-timer"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="image-active-generations"]').exists()).toBe(false)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores pending image placeholders from browser storage on entry', async () => {
    localStorage.setItem(imageStudioPendingStorageKey(), JSON.stringify([
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

  it('does not restore another user pending image task', async () => {
    localStorage.setItem(imageStudioPendingStorageKey(101), JSON.stringify([
      {
        id: 55,
        title: '正在生成',
        src: '',
        meta: 'PNG · 1024x1024 · gpt-image-1',
        pending: true,
        taskId: 'imgtask_private_user',
        batchId: 'batch_private_user',
        prompt: 'private prompt',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
      },
    ]))

    const wrapper = mountImageStudio({ userId: 102 })
    await flushPromises()

    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
  })

  it('resumes a persisted gateway task with the API key that submitted it', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 11, name: 'current', key: 'sk-current', status: 'active', group_id: 2 },
        { id: 22, name: 'original', key: 'sk-original', status: 'active', group_id: 2 },
      ],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    localStorage.setItem(imageStudioPendingStorageKey(), JSON.stringify([
      {
        id: 77,
        title: '正在生成',
        src: '',
        meta: 'PNG · 1024x1024 · gpt-image-1',
        pending: true,
        taskId: 'imgtask_key_restore',
        gatewayTaskId: 'imgtask_key_restore',
        gatewayPollUrl: '/v1/images/tasks/imgtask_key_restore',
        batchId: 'batch_key_restore',
        apiKeyId: 22,
        prompt: '一只猫',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
      },
    ]))
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_key_restore')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_key_restore',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/images/tasks/imgtask_key_restore'),
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-original' } }),
    )
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
  })

  it('does not retry an ambiguous gateway submission after reload', async () => {
    localStorage.setItem(imageStudioPendingStorageKey(), JSON.stringify([
      {
        id: 88,
        title: '正在生成',
        src: '',
        meta: 'PNG · 1024x1024 · gpt-image-1',
        pending: true,
        taskId: 'ambiguous-client-task',
        batchId: 'ambiguous-batch',
        gatewaySubmitPending: true,
        apiKeyId: 11,
        prompt: '一只猫',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
      },
    ]))

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/images/generations'),
      expect.anything(),
    )
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

  it('numbers uploaded references and inserts the selected image token into the prompt', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()

    const fileInput = wrapper.get('input[type="file"]')
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' }),
    ]
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: files,
    })
    await fileInput.trigger('change')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="image-reference-2"]').exists()).toBe(true)
    })
    expect(wrapper.get('[data-testid="reference-index-1"]').text()).toContain('图片 1')
    expect(wrapper.get('[data-testid="reference-index-2"]').text()).toContain('图片 2')

    const promptInput = wrapper.get('textarea.image-composer__prompt')
    await promptInput.setValue('把背景换成')
    await wrapper.get('[data-testid="reference-index-2"]').trigger('click')
    expect((promptInput.element as HTMLTextAreaElement).value).toContain('图片2')

    await wrapper.get('[data-testid="image-reference-1"] .image-composer__remove').trigger('click')
    expect(wrapper.get('[data-testid="reference-index-1"]').text()).toContain('图片 1')
    expect(wrapper.get('[data-testid="image-reference-1"]').text()).toContain('second.png')
  })

  it('keeps the prompt and reference files when the studio remounts', async () => {
    const firstWrapper = mountImageStudio()
    await flushPromises()

    await firstWrapper.get('textarea.image-composer__prompt').setValue('保留这段提示词和参考图')
    const fileInput = firstWrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['reference'], 'keep-me.png', { type: 'image/png' })],
    })
    await fileInput.trigger('change')
    await vi.waitFor(() => {
      expect(firstWrapper.find('[data-testid="image-reference-1"]').exists()).toBe(true)
    })
    await flushPromises()
    firstWrapper.unmount()

    const secondWrapper = mountImageStudio()
    expect(secondWrapper.get('textarea.image-composer__prompt').element.value).toBe('保留这段提示词和参考图')
    expect(secondWrapper.get('[data-testid="image-reference-1"]').text()).toContain('keep-me.png')
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
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
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
    expect(qualityButtons.map((button) => button.text())).toEqual(['自动', '4K', '2K', '1K'])
    expect(qualityButtons[1].attributes('disabled')).toBeUndefined()
    await qualityButtons[1].trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1:1 3840x3840')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(generationBody?.generationConfig?.imageConfig).toEqual({
      aspectRatio: '1:1',
      imageSize: '4K',
    })
  })

  it('resets model-specific size and background controls when switching models', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: 'mixed',
        key: 'sk-mixed',
        status: 'active',
        group_id: 2,
        group: { platform: 'openai', allow_image_generation: true },
      }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-image-1' },
              { id: 'gemini-3.1-flash-image-preview' },
            ],
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()

    const modelSelect = wrapper.get('[data-testid="image-model-select"]')
    await modelSelect.get('button').trigger('click')
    const geminiOption = modelSelect.findAll('button').find((button) => (
      button.text().includes('gemini-3.1-flash-image-preview')
    ))
    await geminiOption!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="quality-select"]').findAll('button').map((button) => button.text()))
      .toEqual(['自动', '4K', '2K', '1K'])
    expect(wrapper.find('.image-composer__toggle-row').exists()).toBe(false)
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1:1 1024x1024')

    await modelSelect.get('button').trigger('click')
    const gptOption = modelSelect.findAll('button').find((button) => button.text().includes('gpt-image-1'))
    await gptOption!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="quality-select"]').findAll('button').map((button) => button.text()))
      .toEqual(['自动', '高', '中', '低'])
    expect(wrapper.find('.image-composer__toggle-row').exists()).toBe(true)
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1:1 1024x1024')
  })

  it('shows Grok-specific resolution and aspect controls without quality or transparency', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: 'grok',
        key: 'sk-grok',
        status: 'active',
        group_id: 2,
        group: { platform: 'grok', allow_image_generation: true },
      }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let generationBody: Record<string, any> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'grok-imagine' }] }),
        } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        generationBody = JSON.parse(String(init?.body || '{}'))
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.find('[data-testid="quality-select"]').exists()).toBe(false)
    expect(wrapper.find('.image-composer__toggle-row').exists()).toBe(false)
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1K · 1:1')

    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    const menuText = wrapper.get('[data-testid="image-size-menu"]').text()
    expect(menuText).toContain('1K · 16:9')
    expect(menuText).toContain('2K · 20:9')
    expect(menuText).not.toContain('4K')

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(generationBody).toEqual(expect.objectContaining({
      resolution: '1k',
      aspect_ratio: '1:1',
    }))
  })

  it('shows standard 4K dimensions for the common aspect ratios', async () => {
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
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gemini-3.1-flash-image-preview' }] }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await wrapper.get('[data-testid="image-size-trigger"]').trigger('click')
    const sizeOptions = wrapper.findAll('.image-composer__size-option').map((button) => button.text())

    expect(sizeOptions).toContain('1:1 1024x1024')
    expect(sizeOptions).toContain('1:1 2048x2048')
    expect(sizeOptions).toContain('1:1 3840x3840')
    expect(sizeOptions).toContain('16:9 3840x2160')
    expect(sizeOptions).toContain('9:16 2160x3840')
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
