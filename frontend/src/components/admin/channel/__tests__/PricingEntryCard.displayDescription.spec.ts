import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PricingEntryCard from '../PricingEntryCard.vue'
import type { PricingFormEntry } from '../types'

vi.mock('@/api/admin/channels', () => ({
  default: { getModelDefaultPricing: vi.fn() },
}))

vi.mock('vue-i18n', async importOriginal => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))

function createEntry(): PricingFormEntry {
  return {
    models: ['seedance-2.0'],
    description: '',
    billing_mode: 'video',
    input_price: null,
    output_price: null,
    cache_write_price: null,
    cache_read_price: null,
    image_input_price: null,
    image_output_price: null,
    per_request_price: 0.6,
    intervals: [],
    time_pricing: {
      timezone: 'Asia/Shanghai',
      weekdays_only: false,
      periods: [],
    },
  }
}

describe('PricingEntryCard display description', () => {
  it('hides the field unless explicitly enabled', () => {
    const wrapper = shallowMount(PricingEntryCard, { props: { entry: createEntry() } })

    expect(wrapper.find('[data-testid="display-description"]').exists()).toBe(false)
  })

  it('shows and updates the model plaza display description', async () => {
    const wrapper = shallowMount(PricingEntryCard, {
      props: { entry: createEntry(), enableDisplayDescription: true },
    })
    const textarea = wrapper.get('[data-testid="display-description"]')
    await textarea.setValue('适合商品视频与多参考素材创作')

    expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({
      description: '适合商品视频与多参考素材创作',
    })
  })
})
