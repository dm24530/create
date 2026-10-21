import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PlazaFilterBar from '../PlazaFilterBar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('PlazaFilterBar compact mode', () => {
  it('keeps filter groups on one horizontally scrollable row', () => {
    const wrapper = mount(PlazaFilterBar, {
      props: {
        platforms: ['openai', 'anthropic'],
        groups: [
          { id: 1, name: 'GPT', platform: 'openai', rate: 1 },
          { id: 2, name: 'Claude', platform: 'anthropic', rate: 1.2 },
        ],
        rates: [1, 1.2],
        platform: 'all',
        groupId: 'all',
        rate: 'all',
        search: '',
        compact: true,
      },
      global: {
        stubs: {
          Icon: true,
          PlatformIcon: true,
        },
      },
    })

    const scrollRows = wrapper.findAll('.plaza-filter-scroll')
    expect(scrollRows).toHaveLength(3)
    expect(scrollRows.every((row) => row.element.children.length > 0)).toBe(true)
  })

  it('can hide group and rate filters', () => {
    const wrapper = mount(PlazaFilterBar, {
      props: {
        platforms: ['openai'],
        groups: [{ id: 1, name: 'GPT', platform: 'openai', rate: 1 }],
        rates: [1],
        platform: 'all',
        groupId: 'all',
        rate: 'all',
        search: '',
        compact: true,
        showGroupAndRateFilters: false,
      },
      global: {
        stubs: {
          Icon: true,
          PlatformIcon: true,
        },
      },
    })

    expect(wrapper.findAll('.plaza-filter-scroll')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('modelPlaza.filters.groupLabel')
    expect(wrapper.text()).not.toContain('modelPlaza.filters.rateLabel')
  })
})
