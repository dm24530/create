import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlazaVideoPricingTable from '../PlazaVideoPricingTable.vue'
import { isVideoPricingModel } from '../videoModelMeta'
import type { PlazaModel } from '@/api/modelPlaza'
import { capabilityFor } from '@/features/video-studio/__tests__/videoCapabilityFixtures'

const { copyToClipboard } = vi.hoisted(() => ({
  copyToClipboard: vi.fn()
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard })
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key })
  }
})

function videoModel(overrides: Partial<PlazaModel> = {}): PlazaModel {
  const model: PlazaModel = {
    name: 'grok-imagine-video-1.5',
    platform: 'grok',
    pricing: {
      billing_mode: 'video',
      input_price: null,
      output_price: null,
      cache_write_price: null,
      cache_read_price: null,
      image_input_price: null,
      image_output_price: null,
      per_request_price: 0.28,
      intervals: [
        {
          min_tokens: 0,
          max_tokens: null,
          tier_label: '480p',
          input_price: null,
          output_price: null,
          cache_write_price: null,
          cache_read_price: null,
          per_request_price: 0.28
        },
        {
          min_tokens: 0,
          max_tokens: null,
          tier_label: '720p',
          input_price: null,
          output_price: null,
          cache_write_price: null,
          cache_read_price: null,
          per_request_price: 0.5
        }
      ]
    },
    official_pricing: null,
    ...overrides
  }
  return {
    ...model,
    video_capabilities: capabilityFor(model.name) || model.video_capabilities,
  }
}

describe('PlazaVideoPricingTable', () => {
  it('copies the model name by clicking the name or the copy button', async () => {
    copyToClipboard.mockResolvedValue(true)
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [videoModel()],
        platform: 'composite',
        rateMultiplier: 1
      }
    })

    await wrapper.get('[data-testid="plaza-video-model-name"]').trigger('click')
    expect(copyToClipboard).toHaveBeenLastCalledWith(
      'grok-imagine-video-1.5',
      'modelPlaza.table.modelCopied'
    )

    await wrapper.get('[data-testid="plaza-video-model-copy"]').trigger('click')
    expect(copyToClipboard).toHaveBeenCalledTimes(2)
  })

  it('shows resolution, billing, supported duration and price as separate columns', () => {
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [videoModel()],
        platform: 'composite',
        rateMultiplier: 1
      }
    })

    const rows = wrapper.findAll('[data-video-pricing-row]')
    const text = wrapper.text()
    expect(rows).toHaveLength(2)
    expect(text).toContain('modelPlaza.videoPricing.resolution')
    expect(text).toContain('modelPlaza.videoPricing.billing')
    expect(text).toContain('modelPlaza.videoPricing.duration')
    expect(text).toContain('modelPlaza.videoPricing.price')
    expect(text).toContain('480p')
    expect(text).toContain('$0.28')
    expect(text).toContain('720p')
    expect(text).toContain('$0.50')
    expect(text).toContain('1–15s')
    expect(text).toContain('modelPlaza.videoPricing.perSecond')
    expect(text).toContain('1s ≈ $0.28')
    expect(text).toContain('15s ≈ $4.20')
  })

  it('shows fixed duration choices for models that only support selected lengths', () => {
    const model = videoModel({ name: 'seedance 2.0 fast-GT' })
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [model],
        rateMultiplier: 1
      }
    })

    expect(wrapper.text()).toContain('10s / 15s')
  })

  it('renders distinct duration rows for per-request video tiers', () => {
    const model = videoModel({ name: 'seedance 2.0 fast-GT' })
    model.pricing!.billing_mode = 'per_request'
    model.pricing!.intervals = [
      {
        min_tokens: 0,
        max_tokens: 10,
        tier_label: '480p-10s',
        input_price: null,
        output_price: null,
        cache_write_price: null,
        cache_read_price: null,
        per_request_price: 2.5
      },
      {
        min_tokens: 0,
        max_tokens: 15,
        tier_label: '480p-15s',
        input_price: null,
        output_price: null,
        cache_write_price: null,
        cache_read_price: null,
        per_request_price: 3.5
      }
    ]

    const wrapper = mount(PlazaVideoPricingTable, {
      props: { models: [model], rateMultiplier: 1 }
    })
    const rows = wrapper.findAll('[data-video-pricing-row]')

    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('480p')
    expect(rows[0].text()).toContain('10s')
    expect(rows[0].text()).toContain('$2.50')
    expect(rows[1].text()).toContain('480p')
    expect(rows[1].text()).toContain('15s')
    expect(rows[1].text()).toContain('$3.50')
  })

  it('compresses consecutive duration presets into readable ranges', () => {
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [videoModel({ name: 'muse-cheap' })],
        rateMultiplier: 1
      }
    })

    expect(wrapper.text()).toContain('1–10s / 20s / 30s')
    expect(wrapper.text()).toContain('1s ≈ $0.28')
    expect(wrapper.text()).toContain('30s ≈ $8.40')
  })
  it('classifies a per-request video model as video when its name is in the video catalog', () => {
    const model = videoModel({ name: 'seedance 2.0 fast-GT' })
    model.pricing!.billing_mode = 'per_request'

    expect(isVideoPricingModel(model)).toBe(true)

    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [model],
        rateMultiplier: 1
      }
    })

    expect(wrapper.text()).toContain('modelPlaza.videoPricing.perRequest')
    expect(wrapper.text()).toContain('modelPlaza.table.perUnitRequest')
    expect(wrapper.text()).not.toContain('modelPlaza.table.perUnitSecond')
  })

  it('shows the full Chinese description without scrolling or extra blank lines', () => {
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [videoModel({ description: '第一行说明\n\n\n第二行说明\n   ' })],
        rateMultiplier: 1
      }
    })

    const description = wrapper.findAll('p').find((item) => item.text().includes('第一行说明'))
    expect(description?.text()).toBe('第一行说明\n第二行说明')
    expect(description?.classes()).not.toContain('max-h-16')
    expect(description?.classes()).not.toContain('overflow-y-auto')
  })
  it('applies the independent video rate to every resolution', () => {
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [videoModel()],
        rateMultiplier: 2,
        videoRateIndependent: true,
        videoRateMultiplier: 0.5
      }
    })

    const text = wrapper.text()
    expect(text).toContain('$0.14')
    expect(text).toContain('$0.25')
    expect(text).not.toContain('$0.56')
  })

  it('falls back to a standard row when no resolution tiers exist', () => {
    const model = videoModel()
    model.pricing!.intervals = []
    model.pricing!.per_request_price = 0.4

    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [model],
        rateMultiplier: 1
      }
    })

    expect(wrapper.text()).toContain('modelPlaza.table.standard')
    expect(wrapper.text()).toContain('$0.40')
  })
})
