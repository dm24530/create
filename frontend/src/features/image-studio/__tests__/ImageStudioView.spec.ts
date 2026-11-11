import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ImageStudioView from '../ImageStudioView.vue'
import { IMAGE_STUDIO_DEFAULT_PROMPT, imageStudioDraft, resetImageStudioDraft } from '../imageStudioDraft'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const { listKeys, getPublicSettings, listGallery, saveGallery, saveGalleryFromTask, pinGallery, deleteGallery, downloadGallery, downloadURLGallery, thumbnailGallery, galleryQuota, reportDisplay, reportClientError, copyToClipboard, imageNeedsLocalResize, processImageForDisplay, prepareImageReferenceImages, createReferenceImagePreview, tryStartPersistent, waitForPersistent } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  getPublicSettings: vi.fn(),
  listGallery: vi.fn(),
  saveGallery: vi.fn(),
  saveGalleryFromTask: vi.fn(),
  pinGallery: vi.fn(),
  deleteGallery: vi.fn(),
  downloadGallery: vi.fn(),
  downloadURLGallery: vi.fn(),
  thumbnailGallery: vi.fn(),
  galleryQuota: vi.fn(),
  reportDisplay: vi.fn(),
  reportClientError: vi.fn(),
  copyToClipboard: vi.fn(),
  imageNeedsLocalResize: vi.fn(),
  processImageForDisplay: vi.fn(),
  prepareImageReferenceImages: vi.fn(),
  createReferenceImagePreview: vi.fn(),
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
    downloadURL: downloadURLGallery,
    thumbnail: thumbnailGallery,
    quota: galleryQuota,
    reportDisplay,
    reportClientError,
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

vi.mock('@/utils/imageReferenceCompression', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/imageReferenceCompression')>()
  return {
    ...actual,
    prepareImageReferenceImages,
  }
})

vi.mock('../referenceImagePreview', () => ({
  createReferenceImagePreview,
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
const componentStyles = readFileSync(
  resolve(dirname(componentPath), 'ImageStudioView.css'),
  'utf8',
)

function imageStudioPendingStorageKey(userId = 2) {
  return `sub2api:image-studio:pending:${userId}`
}

const mountedWrappers = new Set<VueWrapper<any>>()

function mountImageStudio(options: { isAdmin?: boolean; userId?: number; prompt?: string } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const userId = options.userId ?? (options.isAdmin ? 1 : 2)
  const ownerId = String(userId)
  if (!imageStudioDraft.initialized || imageStudioDraft.ownerId !== ownerId) {
    imageStudioDraft.ownerId = ownerId
    imageStudioDraft.initialized = true
    imageStudioDraft.prompt = options.prompt ?? 'test image prompt'
    imageStudioDraft.references = []
  }
  const authStore = useAuthStore(pinia)
  authStore.user = {
    id: userId,
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
  vi.restoreAllMocks()
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
  localStorage.clear()
  sessionStorage.clear()
  listKeys.mockReset()
  getPublicSettings.mockReset()
  listGallery.mockReset()
  saveGallery.mockReset()
  saveGalleryFromTask.mockReset()
  pinGallery.mockReset()
  deleteGallery.mockReset()
  downloadGallery.mockReset()
  downloadURLGallery.mockReset()
  thumbnailGallery.mockReset()
  galleryQuota.mockReset()
  reportDisplay.mockReset()
  reportClientError.mockReset()
  copyToClipboard.mockReset()
  imageNeedsLocalResize.mockReset()
  processImageForDisplay.mockReset()
  prepareImageReferenceImages.mockReset()
  createReferenceImagePreview.mockReset()
  tryStartPersistent.mockReset()
  waitForPersistent.mockReset()
  tryStartPersistent.mockResolvedValue(false)
  waitForPersistent.mockRejectedValue(new Error('Persistent image generation is unavailable'))
  listGallery.mockResolvedValue([])
  pinGallery.mockResolvedValue(undefined)
  deleteGallery.mockResolvedValue(undefined)
  downloadGallery.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  downloadURLGallery.mockResolvedValue({
    url: 'https://cdn.example.com/image-download-url',
    filename: 'image-download.png',
  })
  thumbnailGallery.mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))
  galleryQuota.mockResolvedValue({ used: 0, limit: 100 })
  reportDisplay.mockResolvedValue(undefined)
  reportClientError.mockResolvedValue(undefined)
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
  prepareImageReferenceImages.mockImplementation(async (inputs: Array<{ name: string }>) => inputs.map((input, index) => ({
    name: input.name,
    blob: new Blob(['compressed'], { type: 'image/webp' }),
    dataUrl: `data:image/webp;base64,compressed-${index + 1}`,
    width: 1024,
    height: 768,
    bytes: 10,
    mimeType: 'image/webp',
    profileIndex: 0,
  })))
  createReferenceImagePreview.mockResolvedValue('data:image/jpeg;base64,preview')
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

describe('ImageStudioView prompt defaults', () => {
  it('starts with an empty prompt', () => {
    expect(IMAGE_STUDIO_DEFAULT_PROMPT).toBe('')
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

  it('shows GIF for gpt-image-2-6 and renders the animated source instead of the static thumbnail', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    saveGallery.mockResolvedValue({
      id: 'gallery-gif',
      url: 'https://cdn.example.com/generated.gif',
      thumb_url: 'https://cdn.example.com/generated-thumb.jpg',
      prompt: '',
      model: 'gpt-image-2-6',
      size: '1024x1024',
      format: 'gif',
      saved: true,
      created_at: 1,
      expires_at: 0,
    })
    let generationBody: Record<string, any> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-2-6' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        generationBody = JSON.parse(String(init?.body || '{}'))
        return {
          ok: true,
          json: async () => ({
            data: [{
              b64_json: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
              output_format: 'gif',
              preview_data_url: 'data:image/jpeg;base64,c3RhdGlj',
            }],
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const formatButtons = wrapper.get('[data-testid="image-format-control"]').findAll('button')
    expect(formatButtons.map((button) => button.text())).toEqual(['PNG', 'JPEG', 'WEBP', 'GIF'])

    await formatButtons[3].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(generationBody).toEqual(expect.objectContaining({
      model: 'gpt-image-2-6',
      output_format: 'gif',
    }))
    await vi.waitFor(() => {
      expect(wrapper.find('img[alt^="生成结果"]').exists()).toBe(true)
    })
    expect(wrapper.get('img[alt^="生成结果"]').attributes('src'))
      .toBe('https://cdn.example.com/generated.gif')
    expect(wrapper.find('[data-testid="image-thumbnail-badge"]').exists()).toBe(false)
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
    expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
      error_type: 'client_network_error',
      stage: 'image_studio_visible_error',
      status_code: 499,
    }))
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
    expect(menuText).toContain('1K')
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

  it('keeps rendered gallery URLs stable when only the signed query changes', async () => {
    sessionStorage.setItem('sub2api:image-studio:snapshot-v1:2', JSON.stringify({
      keys: [],
      selectedKeyId: '',
      imageModels: ['gpt-image-1'],
      imageModel: 'gpt-image-1',
      images: [
        {
          id: 'gallery-signed-refresh',
          title: '旧签名缩略图',
          src: 'https://cdn.example.com/work.png?X-Amz-Date=old&X-Amz-Signature=expired',
          thumbSrc: 'https://cdn.example.com/work-thumb.jpg?X-Amz-Date=old&X-Amz-Signature=expired',
          saved: true,
          expiresAt: 0,
          displayOrder: 2,
        },
        {
          id: 'gallery-signed-original',
          title: '旧签名原图',
          src: 'https://cdn.example.com/original.png?X-Amz-Date=old&X-Amz-Signature=expired',
          saved: true,
          expiresAt: 0,
          displayOrder: 1,
        },
      ],
    }))
    listGallery.mockResolvedValue([
      {
        id: 'gallery-signed-refresh',
        url: 'https://cdn.example.com/work.png?X-Amz-Date=new&X-Amz-Signature=fresh',
        thumb_url: 'https://cdn.example.com/work-thumb.jpg?X-Amz-Date=new&X-Amz-Signature=fresh',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: true,
        created_at: 1,
        expires_at: 0,
      },
      {
        id: 'gallery-signed-original',
        url: 'https://cdn.example.com/original.png?X-Amz-Date=new&X-Amz-Signature=fresh',
        prompt: 'a dog',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: true,
        created_at: 2,
        expires_at: 0,
      },
    ])

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('img[alt="旧签名缩略图"]').attributes('src'))
      .toBe('https://cdn.example.com/work-thumb.jpg?X-Amz-Date=old&X-Amz-Signature=expired')
    expect(wrapper.get('img[alt="旧签名原图"]').attributes('src'))
      .toBe('https://cdn.example.com/original.png?X-Amz-Date=old&X-Amz-Signature=expired')
  })

  it('refreshes gallery URLs when the page becomes visible again', async () => {
    listGallery.mockResolvedValue([{
      id: 'gallery-visibility-refresh',
      url: 'https://cdn.example.com/visibility.png',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      saved: true,
      created_at: 1,
      expires_at: 0,
    }])

    mountImageStudio()
    await flushPromises()
    expect(listGallery).toHaveBeenCalledTimes(1)

    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(listGallery).toHaveBeenCalledTimes(2)
  })

  it('limits fallback thumbnail downloads to four at a time', async () => {
    listGallery.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      id: `gallery-${index + 1}`,
      url: `https://cdn.example.com/gallery-${index + 1}.png`,
      prompt: `image ${index + 1}`,
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: index + 1,
      expires_at: 9999999999,
    })))
    thumbnailGallery.mockImplementation(() => new Promise(() => undefined))

    mountImageStudio()
    await vi.waitFor(() => {
      expect(thumbnailGallery).toHaveBeenCalledTimes(4)
    }, { timeout: 2000, interval: 50 })
    await flushPromises()
    expect(thumbnailGallery).toHaveBeenCalledTimes(4)
  })

  it('uses a signed direct download URL for gallery images', async () => {
    let clickedHref = ''
    let clickedTarget = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href
      clickedTarget = this.target
    })
    listGallery.mockResolvedValue([{
      id: 'gallery-download',
      url: 'https://cdn.example.com/gallery-download.png',
      thumb_url: 'https://cdn.example.com/gallery-download-thumb.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '3840x3840',
      format: 'png',
      saved: false,
      created_at: 1,
      expires_at: 9999999999,
    }])
    let resolveDownloadURL!: (value: { url: string; filename: string }) => void
    downloadURLGallery.mockReturnValueOnce(new Promise((resolve) => {
      resolveDownloadURL = resolve
    }))

    const wrapper = mountImageStudio()
    await flushPromises()
    const button = wrapper.get('[data-testid="gallery-image-download"]')
    await button.trigger('click')
    await flushPromises()

    expect(button.attributes('disabled')).toBeDefined()
    expect(downloadURLGallery).toHaveBeenCalledWith('gallery-download')
    expect(fetch).not.toHaveBeenCalled()

    resolveDownloadURL({ url: 'https://cdn.example.com/image-download-url', filename: 'image-download.jpg' })
    await flushPromises()
    expect(clickedHref).toBe('https://cdn.example.com/image-download-url')
    expect(clickedTarget).toBe('')
    expect(downloadGallery).not.toHaveBeenCalled()
  })

  it('waits for a newly generated image to be saved before requesting its direct R2 download URL', async () => {
    let clickedHref = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href
    })
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/generations')) {
        return { ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    let resolveSave!: (entry: any) => void
    saveGallery.mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve
    }))

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    void wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    })
    vi.mocked(fetch).mockClear()

    await wrapper.get('[data-testid="gallery-image-download"]').trigger('click')
    await flushPromises()

    expect(downloadURLGallery).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()

    resolveSave({
      id: 'gallery-new',
      url: 'https://cdn.example.com/gallery-new.png',
      prompt: '',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 0,
      expires_at: 0,
    })
    await vi.waitFor(() => {
      expect(downloadURLGallery).toHaveBeenCalledWith('gallery-new')
    })
    await flushPromises()

    expect(clickedHref).toBe('https://cdn.example.com/image-download-url')
    expect(fetch).not.toHaveBeenCalled()
    expect(downloadGallery).not.toHaveBeenCalled()
  })

  it('falls back to a direct fetch when the signed download URL is unavailable', async () => {
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:gallery-download'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    listGallery.mockResolvedValue([{
      id: 'gallery-signed-download',
      url: 'https://cdn.example.com/gallery-signed.png',
      thumb_url: 'https://cdn.example.com/gallery-signed-thumb.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '3840x3840',
      format: 'png',
      saved: false,
      created_at: 1,
      expires_at: 9999999999,
    }])
    downloadURLGallery.mockRejectedValueOnce(new Error('signed URL unavailable'))
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    } as Response)
    try {
      const wrapper = mountImageStudio()
      await flushPromises()
      await wrapper.get('[data-testid="gallery-image-download"]').trigger('click')
      await flushPromises()

      expect(downloadURLGallery).toHaveBeenCalledWith('gallery-signed-download')
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/gallery-signed.png',
        expect.objectContaining({ credentials: 'omit' }),
      )
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(downloadGallery).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      })
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      })
    }
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
    expect(thumbnailGallery).not.toHaveBeenCalledWith('gallery-1')
    firstWrapper.unmount()

    listGallery.mockReturnValue(new Promise(() => {}))
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    const secondWrapper = mountImageStudio()

    expect(secondWrapper.find('img[src="https://cdn.example.com/gallery-1-thumb.jpg"]').exists()).toBe(true)
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

  it('keeps one generated work after remount when the saved and gallery URLs differ', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let phase = 1
    let savedSortOrder = 0
    let savedPrompt = ''
    let savedModel = ''
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
    listGallery.mockImplementation(async () => phase === 1
      ? []
      : [{
          ...galleryEntry,
          prompt: savedPrompt,
          model: savedModel,
          sort_order: savedSortOrder,
        }])
    saveGallery.mockImplementation(async (request: {
      prompt?: string
      model?: string
      sort_order?: number
    }) => {
      savedSortOrder = Number(request.sort_order || 0)
      savedPrompt = String(request.prompt || '')
      savedModel = String(request.model || '')
      return {
        ...galleryEntry,
        url: 'https://task-storage.example.com/generated-1.png',
        prompt: savedPrompt,
        model: savedModel,
        sort_order: savedSortOrder,
      }
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

    const firstWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await firstWrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()
    expect(firstWrapper.findAll('[data-testid="image-results-grid"] article')).toHaveLength(1)
    firstWrapper.unmount()

    const snapshotKey = 'sub2api:image-studio:snapshot-v1:2'
    const legacySnapshot = JSON.parse(sessionStorage.getItem(snapshotKey) || '{}')
    for (const image of legacySnapshot.images || []) delete image.galleryId
    sessionStorage.setItem(snapshotKey, JSON.stringify(legacySnapshot))

    phase = 2
    const secondWrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    expect(secondWrapper.findAll('[data-testid="image-results-grid"] article')).toHaveLength(1)
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
    expect(componentStyles).toContain('aspect-ratio: 16 / 10')
    expect(thumbnailGallery).not.toHaveBeenCalledWith('gallery-1')

    await media.trigger('click')
    await flushPromises()
    expect(wrapper.get('.image-detail-dialog__media img').attributes('src')).toBe(
      'https://cdn.example.com/gallery-1-thumb.jpg',
    )
  })

  it('labels thumbnail previews and right-click downloads the original', async () => {
    const linkClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    listGallery.mockResolvedValue([{
      id: 'gallery-thumbnail',
      url: 'https://cdn.example.com/gallery-original.png',
      thumb_url: 'https://cdn.example.com/gallery-thumbnail.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '3840x3840',
      format: 'png',
      saved: false,
      created_at: 1,
      expires_at: 9999999999,
    }])

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('[data-testid="image-thumbnail-badge"]').text()).toBe('缩略图预览')
    const media = wrapper.get('[data-testid="image-results-grid"] article > button')
    await media.trigger('contextmenu', { clientX: 24, clientY: 30 })

    const menu = wrapper.get('[data-testid="image-context-menu"]')
    expect(menu.text()).toContain('缩略图预览')
    expect(menu.text()).toContain('下载原图（高清）')

    await wrapper.get('[data-testid="download-original-image"]').trigger('click')
    await flushPromises()

    expect(downloadURLGallery).toHaveBeenCalledWith('gallery-thumbnail')
    linkClick.mockRestore()
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
        sort_order: 1_800_000_000_000_000 + (4 - index),
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

  it('keeps a saved image in its original slot after a gallery refresh', async () => {
    const entries = [
      {
        id: 'newest',
        url: 'https://cdn.example.com/newest.png',
        prompt: 'newest',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: false,
        created_at: 3,
        sort_order: 1_900_000_000_000_003,
        expires_at: 9999999999,
      },
      {
        id: 'saved-middle',
        url: 'https://cdn.example.com/saved-middle.png',
        prompt: 'saved middle',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: true,
        created_at: 2,
        sort_order: 1_900_000_000_000_002,
        expires_at: 0,
      },
      {
        id: 'oldest',
        url: 'https://cdn.example.com/oldest.png',
        prompt: 'oldest',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        saved: false,
        created_at: 1,
        sort_order: 1_900_000_000_000_001,
        expires_at: 9999999999,
      },
    ]
    listGallery.mockResolvedValue(entries)

    const wrapper = mountImageStudio()
    await flushPromises()

    const imageSources = () => wrapper
      .get('[data-testid="image-results-grid"]')
      .findAll('article img')
      .map((image) => image.attributes('src'))
    const before = imageSources()
    expect(before).toEqual([
      'https://cdn.example.com/newest.png',
      'https://cdn.example.com/saved-middle.png',
      'https://cdn.example.com/oldest.png',
    ])

    listGallery.mockResolvedValue([
      { ...entries[0], saved: true, expires_at: 0 },
      entries[1],
      { ...entries[2], saved: true, expires_at: 0 },
    ])
    window.dispatchEvent(new CustomEvent('image-studio-gallery-changed'))
    await flushPromises()

    expect(imageSources()).toEqual(before)
  })

  it('normalizes the cached snapshot order when refreshing the page', async () => {
    sessionStorage.setItem('sub2api:image-studio:snapshot-v1:2', JSON.stringify({
      keys: [],
      selectedKeyId: '',
      imageModels: ['gpt-image-1'],
      imageModel: 'gpt-image-1',
      images: [
        {
          id: 'saved-old',
          title: 'saved old',
          src: 'https://cdn.example.com/saved-old.png',
          saved: true,
          createdAt: 1,
          displayOrder: 1_700_000_000_000,
        },
        {
          id: 'newest',
          title: 'newest',
          src: 'https://cdn.example.com/newest.png',
          saved: false,
          createdAt: 3,
          displayOrder: 1_900_000_000_000_000,
        },
      ],
    }))
    listGallery.mockResolvedValue([])

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(
      wrapper
        .get('[data-testid="image-results-grid"]')
        .findAll('article img')
        .map((image) => image.attributes('src')),
    ).toEqual([
      'https://cdn.example.com/newest.png',
      'https://cdn.example.com/saved-old.png',
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

  it('shows the save action again after a saved gallery image is unpinned', async () => {
    const galleryEntry = {
      id: 'gallery-repin',
      url: 'https://cdn.example.com/gallery-repin.png',
      prompt: 'a dog',
      model: 'gemini-3.1-flash-image-preview',
      size: '3840x3840',
      format: 'jpeg',
      saved: true,
      created_at: 1,
      expires_at: 0,
    }
    listGallery.mockResolvedValue([galleryEntry])

    const wrapper = mountImageStudio()
    await flushPromises()

    const imageButton = wrapper.findAll('button').find((button) =>
      button.find('img[src="https://cdn.example.com/gallery-repin.png"]').exists(),
    )
    await imageButton!.trigger('click')
    expect(wrapper.get('[data-testid="preview-saved-state"]').text()).toContain('已保存到我的作品')

    listGallery.mockResolvedValue([{
      ...galleryEntry,
      saved: false,
      expires_at: Math.floor(Date.now() / 1000) + 86_400,
    }])
    window.dispatchEvent(new CustomEvent('image-studio-gallery-changed'))
    await flushPromises()

    expect(wrapper.find('[data-testid="preview-saved-state"]').exists()).toBe(false)
    const saveButton = wrapper.get('[data-testid="save-preview-to-gallery"]')
    await saveButton.trigger('click')
    await flushPromises()

    expect(pinGallery).toHaveBeenCalledWith('gallery-repin')
    expect(wrapper.get('[data-testid="preview-saved-state"]').text()).toContain('已保存到我的作品')
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
    await wrapper.get('[data-testid="image-prompt-input"]').setValue('一只趴在桌上的橙色小猫，柔和窗边自然光，电影感，极简背景')
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

  it('shows an explicit timeout failure when a sync image request exceeds ten minutes', async () => {
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
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000)
      await flushPromises()

      expect(wrapper.get('[data-testid="image-generation-failure"]').text()).toContain('请求超时')
      expect(wrapper.get('[data-testid="image-generation-failure"]').text()).toContain('10 分钟')
      expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
        error_type: 'client_timeout',
        stage: 'image_generation_failure',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting for an async image submission beyond 30 seconds', async () => {
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
        if (url.endsWith('/images/generations/async')) {
          return new Promise<Response>((resolve, reject) => {
            const timer = window.setTimeout(() => {
              resolve({
                ok: true,
                status: 202,
                json: async () => ({
                  task_id: 'imgtask_queued_75s',
                  status: 'processing',
                  poll_url: '/v1/images/tasks/imgtask_queued_75s',
                }),
              } as Response)
            }, 75_000)
            init?.signal?.addEventListener('abort', () => {
              window.clearTimeout(timer)
              reject(new DOMException('Aborted', 'AbortError'))
            }, { once: true })
          })
        }
        if (url.endsWith('/images/tasks/imgtask_queued_75s')) {
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_queued_75s',
              status: 'completed',
              result: { data: [{ b64_json: 'cXVldWVk', mime_type: 'image/png' }] },
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
      await vi.advanceTimersByTimeAsync(31_000)
      await flushPromises()

      expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(45_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps retrying an unresponsive async submission until the overall deadline', async () => {
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
        if (url.endsWith('/images/generations/async')) {
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
      await vi.advanceTimersByTimeAsync(119_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(2_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(7 * 60_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(60_000)
      await flushPromises()

      const failure = wrapper.get('[data-testid="image-generation-failure"]').text()
      expect(failure).toContain('10 分钟')
      expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
        error_type: 'client_timeout',
        stage: 'image_generation_failure',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a temporary 503 while submitting an async image task', async () => {
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
        if (submitCalls === 1) {
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) } as Response
        }
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: 'imgtask_after_503',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_after_503',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_after_503')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_after_503',
            status: 'ready',
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

    await vi.waitFor(() => {
      expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    })
    expect(submitCalls).toBe(2)
  })

  it('retries a temporary 503 from the task polling endpoint', async () => {
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
            task_id: 'imgtask_poll_503',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_poll_503',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_poll_503')) {
        pollCalls += 1
        if (pollCalls === 1) {
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) } as Response
        }
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_poll_503',
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

    await vi.waitFor(() => {
      expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    }, { timeout: 3000 })
    expect(pollCalls).toBe(2)
  })

  it('retries a timed-out status poll until the overall generation deadline', async () => {
    vi.useFakeTimers()
    try {
      listKeys.mockResolvedValue({
        items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
      })
      getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
      let pollCalls = 0
      vi.mocked(fetch).mockImplementation(async (input, init) => {
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
              task_id: 'imgtask_slow_poll',
              status: 'processing',
              poll_url: '/v1/images/tasks/imgtask_slow_poll',
            }),
          } as Response
        }
        if (url.endsWith('/images/tasks/imgtask_slow_poll')) {
          pollCalls += 1
          if (pollCalls === 1) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'))
              }, { once: true })
            })
          }
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_slow_poll',
              status: 'completed',
              result: { data: [{ b64_json: 'cG9sbGVk', mime_type: 'image/png' }] },
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
      await vi.advanceTimersByTimeAsync(35_000)
      await flushPromises()

      expect(pollCalls).toBeGreaterThanOrEqual(2)
      expect(wrapper.find('[data-testid="image-generation-failure"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not resubmit an upstream failure and keeps the failure record', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const generationBodies: Array<Record<string, any>> = []
    let syncCalls = 0
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
        syncCalls += 1
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: async () => ({ error: { message: 'upstream temporarily unavailable' } }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    const failedPrompt = '一只趴在桌上的橙色小猫，柔和窗边自然光，电影感，极简背景'
    await wrapper.get('[data-testid="image-prompt-input"]').setValue(failedPrompt)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(generationBodies).toHaveLength(1)
    const failure = wrapper.get('[data-testid="image-generation-failure"]')
    expect(failure.text()).toContain('upstream temporarily unavailable')
    expect(syncCalls).toBe(1)
    expect(wrapper.findAll('[data-testid="image-generation-failure"]')).toHaveLength(1)
    expect(wrapper.findAll('img[alt^="生成结果"]')).toHaveLength(0)
    await wrapper.get('[data-testid="copy-failed-prompt"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledWith(failedPrompt, '提示词已复制')
  })

  it('manual retry reuses the failed request and keeps the original failure card', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const generationBodies: Array<Record<string, any>> = []
    let syncCalls = 0
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
        syncCalls += 1
        if (syncCalls === 1) {
          return {
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
            json: async () => ({ error: { message: 'upstream temporarily unavailable' } }),
          } as Response
        }
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: 'cmV0cnktb2s=' }] }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const originalPrompt = generationBodies[0].prompt
    expect(wrapper.get('[data-testid="image-generation-failure"]').text())
      .toContain('upstream temporarily unavailable')

    await wrapper.get('textarea').setValue('edited after failure')
    await wrapper.get('[data-testid="image-retry-generation"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(syncCalls).toBe(2)
    expect(generationBodies[1]).toEqual(expect.objectContaining({
      prompt: originalPrompt,
      model: 'gpt-image-1',
      size: '1024x1024',
    }))
    expect(wrapper.findAll('[data-testid="image-generation-failure"]')).toHaveLength(1)
    expect(wrapper.findAll('img[alt^="生成结果"]')).toHaveLength(1)
  })

  it('stops polling and marks an async image task failed at the three minute deadline', async () => {
    vi.useFakeTimers()
    try {
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
            status: 202,
            json: async () => ({
              task_id: 'imgtask_three_minute_deadline',
              status: 'processing',
              poll_url: '/v1/images/tasks/imgtask_three_minute_deadline',
            }),
          } as Response
        }
        if (url.endsWith('/images/tasks/imgtask_three_minute_deadline')) {
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_three_minute_deadline',
              status: 'processing',
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
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000)
      await flushPromises()

      expect(wrapper.get('[data-testid="image-generation-failure"]').text())
        .toContain('图片生成超过 10 分钟')
      expect(wrapper.find('[data-testid="image-pending-timer"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows an async upstream failure immediately without retrying the poll', async () => {
    vi.useFakeTimers()
    try {
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
              task_id: 'imgtask_immediate_failure',
              status: 'processing',
              poll_url: '/v1/images/tasks/imgtask_immediate_failure',
            }),
          } as Response
        }
        if (url.endsWith('/images/tasks/imgtask_immediate_failure')) {
          pollCalls += 1
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_immediate_failure',
              status: 'failed',
              http_status: 502,
              error: { message: 'upstream rejected immediately' },
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
        .toContain('upstream rejected immediately')
      expect(pollCalls).toBe(1)
      expect(reportClientError).not.toHaveBeenCalledWith(expect.objectContaining({
        stage: 'image_generation_failure',
      }))
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
      expect(payloads[0].sort_order).toBeGreaterThan(payloads[1].sort_order)
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
    let cards = wrapper.findAll('[data-testid="image-results-grid"] article')
    expect(cards[0].find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(cards[1].find('.image-pending-card').exists()).toBe(true)

    await wrapper.get('.studio-results__action').trigger('click')
    await flushPromises()
    cards = wrapper.findAll('[data-testid="image-results-grid"] article')
    expect(cards[0].find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(cards[1].find('.image-pending-card').exists()).toBe(true)

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

  it('shows a completed image preview before local size processing finishes', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    imageNeedsLocalResize.mockReturnValue(true)
    let resolveProcessing!: (result: {
      src: string
      format: string
      processed: boolean
    }) => void
    processImageForDisplay.mockReturnValue(new Promise((resolve) => {
      resolveProcessing = resolve
    }))
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
            task_id: 'imgtask_preview_first',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_preview_first',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_preview_first')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_preview_first',
            status: 'completed',
            result: {
              data: [{
                url: 'https://cdn.example.com/full-size.png',
                preview_data_url: 'data:image/jpeg;base64,cHJldmlldw==',
              }],
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

    expect(wrapper.find('img[alt="生成结果 1"]').attributes('src'))
      .toBe('data:image/jpeg;base64,cHJldmlldw==')

    resolveProcessing({
      src: 'data:image/png;base64,ZnVsbA==',
      format: 'png',
      processed: true,
    })
    await flushPromises()
    expect(wrapper.find('img[alt="生成结果 1"]').attributes('src'))
      .toContain('data:image/jpeg;base64,cHJldmlldw==')
  })

  it('starts local size processing only after the first image load is reported', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    imageNeedsLocalResize.mockReturnValue(true)
    let resolveProcessing!: (result: {
      src: string
      format: string
      processed: boolean
    }) => void
    processImageForDisplay.mockReturnValue(new Promise((resolve) => {
      resolveProcessing = resolve
    }))
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
            task_id: 'imgtask_display_first',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_display_first',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_display_first')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_display_first',
            status: 'completed',
            result: {
              data: [{
                url: 'https://cdn.example.com/display-first.png',
                preview_data_url: 'data:image/jpeg;base64,cHJldmlldw==',
              }],
            },
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
    await wrapper.get('[data-testid="custom-width"]').setValue('2880')
    await wrapper.get('[data-testid="custom-height"]').setValue('2880')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const image = wrapper.get('img[alt="生成结果 1"]')
    expect(image.attributes('src')).toBe('data:image/jpeg;base64,cHJldmlldw==')
    expect(reportDisplay).not.toHaveBeenCalled()
    expect(processImageForDisplay).not.toHaveBeenCalled()

    await image.trigger('load')
    expect(reportDisplay).toHaveBeenCalledWith('imgtask_display_first', expect.any(Number))
    expect(processImageForDisplay).toHaveBeenCalledTimes(1)

    resolveProcessing({
      src: 'data:image/png;base64,cHJvY2Vzc2Vk',
      format: 'png',
      processed: true,
    })
    await flushPromises()
  })

  it('shows every completed preview without waiting for another image resize', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    imageNeedsLocalResize.mockReturnValue(true)
    const pendingProcessors: Array<(result: {
      src: string
      format: string
      processed: boolean
    }) => void> = []
    processImageForDisplay.mockImplementation(() => new Promise((resolve) => {
      pendingProcessors.push(resolve)
    }))
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
            task_id: `imgtask_parallel_${submitCalls}`,
            status: 'processing',
            poll_url: `/v1/images/tasks/imgtask_parallel_${submitCalls}`,
          }),
        } as Response
      }
      const task = url.match(/\/images\/tasks\/imgtask_parallel_(\d+)$/)?.[1]
      if (task) {
        return {
          ok: true,
          json: async () => ({
            task_id: `imgtask_parallel_${task}`,
            status: 'completed',
            result: {
              data: [{
                url: `https://cdn.example.com/parallel-${task}.png`,
                preview_data_url: `data:image/jpeg;base64,cHJldmlldy0${task}=`,
              }],
            },
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
    await wrapper.get('[data-testid="custom-width"]').setValue('2880')
    await wrapper.get('[data-testid="custom-height"]').setValue('2880')
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[1].trigger('click')
    const submitPromise = wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
      expect(wrapper.findAll('img[alt^="生成结果"]')).toHaveLength(2)
    })

    for (const resolveProcess of pendingProcessors) {
      resolveProcess({
        src: 'data:image/png;base64,cHJvY2Vzc2Vk',
        format: 'png',
        processed: true,
      })
    }
    await submitPromise
    await flushPromises()
  })

  it('restores failed and pending images in their original slot order', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const now = Date.now()
    localStorage.setItem(imageStudioPendingStorageKey(), JSON.stringify([{
      id: 12,
      title: '正在生成 2',
      src: '',
      meta: 'PNG · 1024x1024 · gpt-image-1',
      pending: true,
      taskId: 'pending-task',
      batchId: 'batch-order',
      startedAt: now,
      displayOrder: 200,
      prompt: 'pending task',
    }]))
    localStorage.setItem('sub2api:image-studio:failures:2', JSON.stringify([{
      id: 11,
      title: '生成失败',
      src: '',
      meta: 'PNG · 1024x1024 · gpt-image-1',
      failed: true,
      error: 'upstream failed',
      batchId: 'batch-order',
      displayOrder: 201,
      prompt: 'failed task',
    }]))

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="image-results-grid"] article')
    expect(cards).toHaveLength(2)
    expect(cards[0].find('[data-testid="image-generation-failure"]').exists()).toBe(true)
    expect(cards[1].find('.image-pending-card').exists()).toBe(true)
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
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
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
          now += 51_000
          return {
            ok: true,
            json: async () => ({
              task_id: 'imgtask_preview_ready',
              status: 'preview_ready',
              result: { data: [{ url: 'data:image/jpeg;base64,cHJldmlldw==' }] },
            }),
          } as Response
        }
        now += 8_000
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
    await wrapper.get('.image-pending-card--preview img').trigger('load')
    expect(reportDisplay).toHaveBeenCalledTimes(1)
    expect(reportDisplay).toHaveBeenCalledWith('imgtask_preview_ready', expect.any(Number))
    await wrapper.get('.image-result-card__media').trigger('click')
    expect(wrapper.get('.image-detail-dialog__media img').attributes('src'))
      .toBe('data:image/jpeg;base64,cHJldmlldw==')
    expect(wrapper.get('[data-testid="image-generation-duration"]').text()).toBe('51 秒')
    expect(wrapper.get('[data-testid="save-preview-to-gallery"]').attributes('disabled')).toBeDefined()

    await vi.waitFor(() => {
      expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
    }, { timeout: 4000, interval: 50 })
    await wrapper.get('img[alt="生成结果 1"]').trigger('load')
    expect(reportDisplay).toHaveBeenCalledTimes(1)
    expect(saveGalleryFromTask).toHaveBeenCalledWith(expect.objectContaining({
      task_id: 'imgtask_preview_ready',
    }))
  })

  it('shows the preview while the original is only used on demand', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    saveGalleryFromTask.mockResolvedValueOnce({
      id: 'gallery-task-local',
      url: '',
      prompt: '',
      model: '',
      size: '',
      format: 'png',
      created_at: 0,
      expires_at: 0,
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
        return {
          ok: true,
          status: 202,
          json: async () => ({
            task_id: 'imgtask_local_original',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_local_original',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_local_original')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_local_original',
            status: 'completed',
            result: {
              data: [{
                object_key: 'images/users/1/imgtask_local_original-0.png',
                mime_type: 'image/png',
                upload_status: 'pending',
                original_ready: true,
                preview_data_url: 'data:image/jpeg;base64,cHJldmlldw==',
              }],
            },
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_local_original/content?index=0')) {
        return {
          ok: true,
          blob: async () => new Blob(['original'], { type: 'image/png' }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      const image = wrapper.get('img[alt="生成结果 1"]')
      expect(image.attributes('src')).toBe('data:image/jpeg;base64,cHJldmlldw==')
    }, { timeout: 3000, interval: 50 })
    expect(wrapper.find('.image-pending-card').exists()).toBe(false)
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/content?index=0'))).toBe(false)

    downloadURLGallery.mockRejectedValueOnce(new Error('pending upload has no signed URL'))
    const originalCreateObjectURL = URL.createObjectURL
    const originalWindowCreateObjectURL = window.URL.createObjectURL
    const createObjectURL = vi.fn(() => 'blob:downloaded-original')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await wrapper.get('[data-testid="gallery-image-download"]').trigger('click')
    await vi.waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/content?index=0'))).toBe(true)
    })
    click.mockRestore()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: originalWindowCreateObjectURL,
    })
    wrapper.unmount()
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
    const submitCall = fetchMock.mock.calls.find(([input]) => (
      String(input).endsWith('/images/generations/async')
    ))
    expect(JSON.parse(String((submitCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      model: 'gpt-image-1',
      response_format: 'url',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/images/tasks/imgtask_server'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-local' }) }),
    )
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toBeNull()
    expect(saveGalleryFromTask).toHaveBeenCalledWith(expect.objectContaining({
      task_id: 'imgtask_server',
      image_index: 0,
      saved: false,
    }))
    expect(saveGallery).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="copy-generated-prompt"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledWith('test image prompt', '提示词已复制')

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
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/images/tasks/imgtask_partial'),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-original' }) }),
      )
    })
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(1)
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toContain('"gatewaySubmitPending":true')
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
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(1)
    expect(localStorage.getItem(imageStudioPendingStorageKey())).toContain('"gatewaySubmitPending":true')
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
    expect(thumbnailGallery).not.toHaveBeenCalledWith('gallery-1')
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
      thumb_url: 'https://cdn.example.com/loading-thumb.jpg',
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
    const preview = wrapper.get('.image-detail-dialog__media img')
    expect(preview.attributes('src')).toBe('https://cdn.example.com/loading-thumb.jpg')
    expect(preview.classes()).not.toContain('opacity-0')
    expect(wrapper.get('[data-testid="preview-image-loading"]').text()).toContain('已显示预览')

    await preview.trigger('load')

    expect(wrapper.find('[data-testid="preview-image-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="image-media-loading"]').exists()).toBe(false)
  })

  it('falls back to the original image when a thumbnail fails', async () => {
    thumbnailGallery.mockRejectedValueOnce(new Error('thumbnail unavailable'))
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

  it('recovers a failed remote thumbnail through the backend thumbnail endpoint', async () => {
    listGallery.mockResolvedValue([{
      id: 'gallery-recover',
      url: 'https://cdn.example.com/original.png',
      thumb_url: 'https://cdn.example.com/temporarily-missing-thumb.jpg',
      prompt: 'a cat',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: 1,
      expires_at: 9999999999,
    }])

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('img[alt="历史图片 1"]').attributes('src'))
      .toBe('https://cdn.example.com/temporarily-missing-thumb.jpg')

    await wrapper.get('img[alt="历史图片 1"]').trigger('error')
    await flushPromises()

    expect(thumbnailGallery).toHaveBeenCalledWith('gallery-recover')
    await vi.waitFor(() => {
      expect(wrapper.get('img[alt="历史图片 1"]').attributes('src'))
        .toBe('data:image/jpeg;base64,dGh1bWI=')
    })
  })

  it('recovers a stalled remote thumbnail after the load timeout', async () => {
    vi.useFakeTimers()
    try {
      listGallery.mockResolvedValue([{
        id: 'gallery-stalled',
        url: 'https://cdn.example.com/original.png',
        thumb_url: 'https://cdn.example.com/stalled-thumb.jpg',
        prompt: 'a cat',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
        created_at: 1,
        expires_at: 9999999999,
      }])

      const wrapper = mountImageStudio()
      await flushPromises()

      await vi.advanceTimersByTimeAsync(10_000)
      await flushPromises()

      expect(thumbnailGallery).toHaveBeenCalledWith('gallery-stalled')
      await vi.waitFor(() => {
        expect(wrapper.get('img[alt="历史图片 1"]').attributes('src'))
          .toBe('data:image/jpeg;base64,dGh1bWI=')
      })
    } finally {
      vi.useRealTimers()
    }
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

      await vi.advanceTimersByTimeAsync(10_000)
      await flushPromises()
      expect(wrapper.get('img[alt="历史图片 1"]').attributes('src')).toBe(
        'https://cdn.example.com/slow-original.png',
      )

      await vi.advanceTimersByTimeAsync(10_000)
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
    await wrapper.get('[data-testid="image-prompt-input"]').setValue('一只趴在桌上的橙色小猫，柔和窗边自然光，电影感，极简背景')
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

  it('shows the image before required local resizing finishes', async () => {
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
      expect(wrapper.get('img[alt="生成结果 1"]').attributes('src'))
        .toContain('data:image/png;base64,')
    })
    await wrapper.get('img[alt="生成结果 1"]').trigger('load')
    await vi.waitFor(() => {
      expect(processImageForDisplay).toHaveBeenCalledWith(
        expect.stringContaining('data:image/png;base64,'),
        '4096x4096',
        'png',
      )
    })

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

  it('does not run local size processing for a non-custom ratio request', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    imageNeedsLocalResize.mockReturnValue(true)
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
            task_id: 'imgtask_ratio_original',
            status: 'processing',
            poll_url: '/v1/images/tasks/imgtask_ratio_original',
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_ratio_original')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_ratio_original',
            status: 'completed',
            result: {
              data: [{
                url: 'https://cdn.example.com/original.png',
                preview_data_url: 'data:image/png;base64,b3JpZ2luYWw=',
              }],
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
    await wrapper.get('img[alt="生成结果 1"]').trigger('load')
    await flushPromises()

    expect(processImageForDisplay).not.toHaveBeenCalled()
    expect(wrapper.get('img[alt="生成结果 1"]').attributes('src'))
      .toBe('data:image/png;base64,b3JpZ2luYWw=')
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

  it('keeps every result in the slot reserved when the task was submitted', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'dd', key: 'sk-local', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const resolvers: Array<(response: Response) => void> = []
    let savedIndex = 0
    saveGallery.mockImplementation(async () => ({
      id: `gallery-slot-${++savedIndex}`,
      url: `https://cdn.example.com/gallery-slot-${savedIndex}.png`,
      prompt: '',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
      created_at: savedIndex,
      expires_at: 0,
      // Deliberately opposite to completion order. Submission slots must win.
      sort_order: 1_900_000_000_000_000 - savedIndex,
    }))
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
    await wrapper.get('[data-testid="image-count-control"]').findAll('button')[2].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(resolvers).toHaveLength(3)
    const cards = () => wrapper
      .get('[data-testid="image-results-grid"]')
      .findAll('article')

    // Finish the middle request first. It must fill slot 2 without moving to
    // the front or displacing the other still-pending cards.
    resolvers[1]({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'bWlkZGxl' }] }),
    } as Response)
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(3)
      expect(cards()[1].find('img[alt="生成结果 1"]').exists()).toBe(true)
    })
    expect(cards()[0].find('.image-pending-card').exists()).toBe(true)
    expect(cards()[2].find('.image-pending-card').exists()).toBe(true)

    resolvers[0]({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'Zmlyc3Q=' }] }),
    } as Response)
    resolvers[2]({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'bGFzdA==' }] }),
    } as Response)
    await flushPromises()
    await flushPromises()

    await vi.waitFor(() => {
      expect(saveGallery).toHaveBeenCalledTimes(3)
      expect(cards()).toHaveLength(3)
      expect(cards().map((card) => card.get('img[alt^="生成结果"]').attributes('alt'))).toEqual([
        '生成结果 2',
        '生成结果 1',
        '生成结果 3',
      ])
    })
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
      expect(wrapper.get('[data-testid="image-pending-timer"]').text()).toBe('1 秒')

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

  it('marks a restored pending task as timed out after ten minutes', async () => {
    localStorage.setItem(imageStudioPendingStorageKey(), JSON.stringify([
      {
        id: 56,
        title: '正在生成',
        src: '',
        meta: 'PNG · 1024x1024 · gpt-image-1',
        pending: true,
        taskId: 'imgtask_restore_timed_out',
        batchId: 'batch_restore_timed_out',
        startedAt: Date.now() - 10 * 60 * 1000 - 1,
        prompt: '一只猫',
        model: 'gpt-image-1',
        size: '1024x1024',
        format: 'png',
      },
    ]))

    const wrapper = mountImageStudio()
    await flushPromises()

    expect(wrapper.get('[data-testid="image-generation-failure"]').text())
      .toContain('图片生成超过 10 分钟')
    expect(wrapper.findAll('.image-pending-card')).toHaveLength(0)
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

  it('recovers an ambiguous gateway submission by idempotency key after reload', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 11, name: 'dd', key: 'sk-ambiguous', status: 'active', group_id: 2 }],
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
      if (url.endsWith('/images/tasks/by-idempotency/ambiguous-client-task')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_recovered',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_recovered')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_recovered',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

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
    await flushPromises()

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/images/tasks/by-idempotency/ambiguous-client-task'),
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-ambiguous' } }),
    )
    expect(wrapper.find('img[alt="生成结果 1"]').exists()).toBe(true)
  })

  it('deduplicates ambiguous recovery probes for the same idempotency key', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 11, name: 'dd', key: 'sk-ambiguous', status: 'active', group_id: 2 }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    const fetchMock = vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-image-1' }] }) } as Response
      }
      if (url.endsWith('/images/tasks/by-idempotency/shared-client-task')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_shared',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      if (url.endsWith('/images/tasks/imgtask_shared')) {
        return {
          ok: true,
          json: async () => ({
            task_id: 'imgtask_shared',
            status: 'completed',
            result: { data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const pendingImage = {
      title: '正在生成',
      src: '',
      meta: 'PNG · 1024x1024 · gpt-image-1',
      pending: true,
      taskId: 'shared-client-task',
      batchId: 'shared-batch',
      gatewaySubmitPending: true,
      apiKeyId: 11,
      prompt: '一只猫',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
    }
    localStorage.setItem(imageStudioPendingStorageKey(), JSON.stringify([
      { ...pendingImage, id: 88 },
      { ...pendingImage, id: 89 },
    ]))

    mountImageStudio()
    await flushPromises()
    await flushPromises()
    await flushPromises()

    const recoveryCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input).endsWith('/images/tasks/by-idempotency/shared-client-task')
    ))
    expect(recoveryCalls).toHaveLength(1)
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

  it('compresses all 14 references before sending a Gemini image request', async () => {
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
          json: async () => ({ data: [{ id: 'gemini-nano-banana-2.1' }] }),
        } as Response
      }
      if (url.endsWith('/images/generations/async')) return asyncImageUnavailableResponse()
      if (url.includes('gemini-nano-banana-2.1:generateContent')) {
        generationBody = JSON.parse(String(init?.body || '{}'))
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: 'cmVzdWx0' } }],
              },
            }],
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="image-model-select"]').text()).toContain('gemini-nano-banana-2.1')
    })

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: Array.from({ length: 14 }, (_, index) => (
        new File([`image-${index + 1}`], `image-${index + 1}.png`, { type: 'image/png' })
      )),
    })
    await fileInput.trigger('change')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="image-reference-14"]').exists()).toBe(true)
    })

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(generationBody).not.toBeNull()
    })

    expect(prepareImageReferenceImages).toHaveBeenCalledOnce()
    const geminiParts = generationBody?.contents?.[0]?.parts || []
    expect(geminiParts.filter((part: any) => part.inlineData?.mimeType === 'image/webp')).toHaveLength(14)
  })

  it('allows another generation while reference compression is still in flight', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: 'openai',
        key: 'sk-openai',
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
          json: async () => ({ data: [{ id: 'gpt-image-2.6' }] }),
        } as Response
      }
      if (url.endsWith('/images/edits/async')) return asyncImageUnavailableResponse()
      throw new Error(`Unexpected request: ${url}`)
    })
    let pendingPreparations = 0
    vi.mocked(prepareImageReferenceImages).mockImplementation(() => {
      pendingPreparations += 1
      return new Promise(() => {})
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="image-model-select"]').text()).toContain('gpt-image-2.6')
    })

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['reference'], 'reference.png', { type: 'image/png' })],
    })
    await fileInput.trigger('change')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="image-reference-1"]').exists()).toBe(true)
    })

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(pendingPreparations).toBe(1)
    })

    const submitButton = wrapper.get('.image-composer__generate')
    expect(submitButton.attributes('disabled')).toBeUndefined()
    expect(submitButton.text()).toContain('继续生成')

    await wrapper.get('textarea.image-composer__prompt').setValue('')
    expect(submitButton.attributes('disabled')).toBeUndefined()

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(pendingPreparations).toBe(2)
    })
    expect(wrapper.get('[data-testid="image-active-generations"]').text()).toContain('2 个任务进行中')
  })

  it('sends all 14 compressed references inline in a multipart image edit request', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: 'openai',
        key: 'sk-openai',
        status: 'active',
        group_id: 2,
        group: { platform: 'openai', allow_image_generation: true },
      }],
    })
    getPublicSettings.mockResolvedValue({ api_base_url: '/v1' })
    let editBody: FormData | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/images/batches/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gpt-image-2.6' }] }),
        } as Response
      }
      if (url.endsWith('/images/edits/async')) return asyncImageUnavailableResponse()
      if (url.endsWith('/images/edits')) {
        expect(init?.body).toBeInstanceOf(FormData)
        editBody = init?.body as FormData
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: 'cmVzdWx0', mime_type: 'image/png' }] }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="image-model-select"]').text()).toContain('gpt-image-2.6')
    })

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: Array.from({ length: 14 }, (_, index) => (
        new File([`original-${index + 1}`], `image-${index + 1}.png`, { type: 'image/png' })
      )),
    })
    await fileInput.trigger('change')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="image-reference-14"]').exists()).toBe(true)
    })

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(editBody).not.toBeNull()
    })

    expect(prepareImageReferenceImages).toHaveBeenCalledOnce()
    const files = editBody!.getAll('image[]')
    expect(files).toHaveLength(14)
    expect(files.every((file) => (file as Blob).type === 'image/webp')).toBe(true)
  })

  it('shows model-specific reference and quality limits before generation', async () => {
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
          json: async () => ({
            data: [
              { id: 'gemini-nano-banana-2.1' },
              { id: 'gemini-2.5-flash-image' },
              { id: 'gemini-3.1-flash-lite-image' },
            ],
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    const modelSelect = wrapper.get('[data-testid="image-model-select"]')
    await vi.waitFor(() => {
      expect(modelSelect.text()).toContain('gemini-2.5-flash-image')
    })
    await modelSelect.get('button').trigger('click')
    const nanoOption = modelSelect.findAll('button').find((button) => button.text().includes('gemini-nano-banana-2.1'))
    await nanoOption!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="image-reference-limit-hint"]').text()).toContain('最多 14 张')

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: Array.from({ length: 14 }, (_, index) => (
        new File([`image-${index + 1}`], `image-${index + 1}.png`, { type: 'image/png' })
      )),
    })
    await fileInput.trigger('change')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="image-reference-14"]').exists()).toBe(true)
    })

    await modelSelect.get('button').trigger('click')
    const flashOption = modelSelect.findAll('button').find((button) => button.text().includes('gemini-2.5-flash-image'))
    await flashOption!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="image-reference-limit-hint"]').text()).toContain('最多 3 张')
    expect(wrapper.get('[data-testid="image-reference-limit-warning"]').text()).toContain('请移除 11 张')
    expect(wrapper.get('button.image-composer__generate').attributes('disabled')).toBeDefined()

    const quality4K = wrapper.get('[data-testid="quality-select"]').findAll('button')
      .find((button) => button.text() === '4K')
    await quality4K!.trigger('click')
    await modelSelect.get('button').trigger('click')
    const liteOption = modelSelect.findAll('button').find((button) => button.text().includes('gemini-3.1-flash-lite-image'))
    await liteOption!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="image-model-quality-warning"]').text()).toContain('只支持 1K')
    expect(wrapper.get('[data-testid="quality-select"]').text()).not.toContain('4K')
  })

  it('serializes rapid reference additions so the 14-image cap cannot be bypassed', async () => {
    const wrapper = mountImageStudio()
    await flushPromises()
    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: Array.from({ length: 14 }, (_, index) => (
        new File([`image-${index + 1}`], `image-${index + 1}.png`, { type: 'image/png' })
      )),
    })
    await fileInput.trigger('change')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['extra'], 'extra.png', { type: 'image/png' })],
    })
    await fileInput.trigger('change')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="image-reference-14"]').exists()).toBe(true)
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="image-reference-15"]').exists()).toBe(false)
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

  it('maps GPT image quality to 4K, 2K and 1K size presets', async () => {
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: 'openai',
        key: 'sk-openai',
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
          json: async () => ({ data: [{ id: 'gpt-image-2-5-sunburst' }] }),
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = mountImageStudio()
    await flushPromises()
    await flushPromises()

    const qualityButtons = wrapper.get('[data-testid="quality-select"]').findAll('button')
    await qualityButtons[1].trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1:1 2880x2880')

    await qualityButtons[2].trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1:1 2048x2048')

    await qualityButtons[3].trigger('click')
    expect(wrapper.get('[data-testid="image-size-trigger"]').text()).toContain('1:1 1024x1024')
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
