import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PlazaFilterBar from '../PlazaFilterBar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const groups = [
  { id: 1, name: '标准创作', modelCount: 8 },
  { id: 2, name: '高级创作', modelCount: 3 },
]

function mountFilterBar(overrides: Record<string, unknown> = {}) {
  return mount(PlazaFilterBar, {
    props: {
      groups,
      groupId: 'all',
      search: '',
      compact: true,
      ...overrides,
    },
    global: {
      stubs: {
        Icon: true,
      },
    },
  })
}

describe('PlazaFilterBar group-first filters', () => {
  it('shows group names as the primary filter instead of platform controls', () => {
    const wrapper = mountFilterBar()

    expect(wrapper.text()).not.toContain('modelPlaza.filters.platformLabel')
    expect(wrapper.text()).toContain('标准创作')
    expect(wrapper.text()).toContain('高级创作')
    expect(wrapper.text()).toContain('8')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(3)
  })

  it('keeps group tabs on one row in compact modal mode', () => {
    const wrapper = mountFilterBar()
    const scrollRows = wrapper.findAll('.plaza-filter-scroll')

    expect(scrollRows).toHaveLength(1)
    expect(scrollRows[0].element.children.length).toBe(3)
  })

  it('emits the selected group id', async () => {
    const wrapper = mountFilterBar()
    const groupTab = wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text().includes('高级创作'))

    expect(groupTab).toBeDefined()
    await groupTab!.trigger('click')

    expect(wrapper.emitted('update:groupId')?.[0]).toEqual([2])
  })

  it('does not expose rate filtering', () => {
    const wrapper = mountFilterBar()

    expect(wrapper.text()).not.toContain('modelPlaza.filters.rateLabel')
    expect(wrapper.text()).toContain('标准创作')
  })
})
