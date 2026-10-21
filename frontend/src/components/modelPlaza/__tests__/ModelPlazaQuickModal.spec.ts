import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelPlazaQuickModal from '../ModelPlazaQuickModal.vue'

const { getPlaza, getAvailableModels } = vi.hoisted(() => ({
  getPlaza: vi.fn(),
  getAvailableModels: vi.fn(),
}))

vi.mock('@/api/modelPlaza', () => ({
  getModelPlaza: getPlaza,
}))

vi.mock('@/api/channels', () => ({
  userChannelsAPI: {
    getAvailableModels,
  },
}))

const stubs = {
  BaseDialog: {
    props: ['show', 'title', 'width', 'bodyClass', 'closeOnClickOutside'],
    emits: ['close'],
    template: '<div v-if="show"><slot /></div>',
  },
  ModelPlazaContent: {
    props: {
      response: Object,
      loading: Boolean,
      error: Boolean,
      embedded: Boolean,
      compactFilters: Boolean,
      showGroupAndRateFilters: Boolean,
    },
    template: '<div data-testid="plaza-content" />',
  },
}

describe('ModelPlazaQuickModal', () => {
  beforeEach(() => {
    getPlaza.mockReset().mockResolvedValue({ description: '', groups: [] })
    getAvailableModels.mockReset().mockResolvedValue([])
  })

  it('loads the plaza and renders it in compact modal mode', async () => {
    const wrapper = mount(ModelPlazaQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    expect(getPlaza).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(stubs.BaseDialog).props('closeOnClickOutside')).toBe(true)
    expect(wrapper.findComponent(stubs.ModelPlazaContent).props()).toMatchObject({
      embedded: true,
      compactFilters: true,
      showGroupAndRateFilters: false,
      error: false,
    })
  })

  it('falls back to available model pricing when the plaza endpoint is disabled', async () => {
    getPlaza.mockRejectedValue(new Error('404'))
    getAvailableModels.mockResolvedValue([{
      name: 'channel',
      description: '',
      platforms: [{
        platform: 'openai',
        groups: [{
          id: 3,
          name: '综合创作',
          platform: 'composite',
          subscription_type: 'standard',
          rate_multiplier: 1,
          peak_rate_enabled: false,
          peak_start: '',
          peak_end: '',
          peak_rate_multiplier: 1,
          is_exclusive: false,
        }],
        supported_models: [{
          name: 'gpt-image-2',
          platform: 'openai',
          pricing: {
            billing_mode: 'per_request',
            input_price: null,
            output_price: null,
            cache_write_price: null,
            cache_read_price: null,
            image_input_price: null,
            image_output_price: null,
            per_request_price: 0.08,
            intervals: [],
          },
        }],
      }],
    }])

    const wrapper = mount(ModelPlazaQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    const content = wrapper.findComponent(stubs.ModelPlazaContent)
    expect(content.props('response')).toMatchObject({
      groups: [{
        id: 3,
        models: [{ name: 'gpt-image-2', platform: 'openai' }],
      }],
    })
    expect(content.props('error')).toBe(false)
  })
})
