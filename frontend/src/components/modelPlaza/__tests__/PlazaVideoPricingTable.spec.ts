import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlazaVideoPricingTable from '../PlazaVideoPricingTable.vue'
import type { PlazaModel } from '@/api/modelPlaza'

const { copyToClipboard } = vi.hoisted(() => ({
  copyToClipboard: vi.fn()
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

function videoModel(overrides: Partial<PlazaModel> = {}): PlazaModel {
  return {
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

  it('shows model name on the left and all resolution prices on one row', () => {
    const wrapper = mount(PlazaVideoPricingTable, {
      props: {
        models: [videoModel()],
        platform: 'composite',
        rateMultiplier: 1
      }
    })

    const row = wrapper.find('[data-video-pricing-row]')
    const text = wrapper.text()
    expect(text).toContain('grok-imagine-video-1.5')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('480p')
    expect(row.text()).toContain('$0.28')
    expect(row.text()).toContain('720p')
    expect(row.text()).toContain('$0.50')
    expect(row.text()).toContain('modelPlaza.table.perUnitSecond')
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

  it('falls back to a standard per-second row when no resolution tiers exist', () => {
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
