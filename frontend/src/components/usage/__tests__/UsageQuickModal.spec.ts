import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UsageQuickModal from '../UsageQuickModal.vue'

const { queryUsage, getUsageStats, listKeys } = vi.hoisted(() => ({
  queryUsage: vi.fn(),
  getUsageStats: vi.fn(),
  listKeys: vi.fn(),
}))

vi.mock('@/api/usage', () => ({
  default: {
    query: queryUsage,
    getStats: getUsageStats,
  },
}))

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
  },
}))

const stubs = {
  BaseDialog: {
    props: ['show', 'title', 'width', 'closeOnClickOutside', 'bodyClass'],
    emits: ['close'],
    template:
      '<div v-if="show"><button v-if="closeOnClickOutside" data-testid="backdrop" @click="$emit(\'close\')">backdrop</button><slot /></div>',
  },
  UsageStatsCards: true,
  UsageTable: {
    props: ['data', 'loading', 'columns', 'emptyMessage', 'serverSideSort', 'showAccountBilling', 'showUpstreamEndpoint', 'statusInTypeColumn', 'defaultSortKey', 'defaultSortOrder', 'flat'],
    template: '<div data-testid="usage-table" />',
  },
  Pagination: {
    props: ['page', 'total', 'pageSize'],
    template: '<div data-testid="pagination">{{ total }}</div>',
  },
  Select: true,
  DateRangePicker: true,
  Icon: true,
}

describe('UsageQuickModal', () => {
  beforeEach(() => {
    queryUsage.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    getUsageStats.mockReset().mockResolvedValue(null)
    listKeys.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100, pages: 0 })
  })

  it('closes when the backdrop is clicked', async () => {
    const wrapper = mount(UsageQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    expect(wrapper.findComponent(stubs.BaseDialog).props('width')).toBe('screen')
    expect(wrapper.findComponent(stubs.BaseDialog).props('closeOnClickOutside')).toBe(true)
    await wrapper.get('[data-testid="backdrop"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('loads usage automatically when opened and still supports manual refresh', async () => {
    const wrapper = mount(UsageQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    expect(queryUsage).toHaveBeenCalledTimes(1)
    expect(getUsageStats).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent(stubs.UsageTable).props('emptyMessage')).toBeUndefined()

    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()

    expect(queryUsage).toHaveBeenCalledTimes(2)
    expect(getUsageStats).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(stubs.UsageTable).props('emptyMessage')).toBeUndefined()
  })

  it('keeps pagination outside the scrollable table and disables body scrolling', async () => {
    queryUsage.mockResolvedValue({ items: [], total: 45, page: 1, page_size: 20, pages: 3 })
    const wrapper = mount(UsageQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    expect(wrapper.findComponent(stubs.BaseDialog).props('bodyClass')).toBe('usage-quick-modal-body')
    expect(wrapper.get('[data-testid="pagination"]').text()).toBe('45')
  })

  it('shows the billed price for every usage record', async () => {
    const wrapper = mount(UsageQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    const columnKeys = wrapper.findComponent(stubs.UsageTable).props('columns').map((column: { key: string }) => column.key)
    expect(columnKeys).toContain('cost')
    expect(columnKeys).not.toContain('status')
    expect(wrapper.findComponent(stubs.UsageTable).props('statusInTypeColumn')).toBe(true)
  })

  it('passes failed requests returned by the merged usage endpoint to the table', async () => {
    queryUsage.mockResolvedValue({
      items: [{
        id: -7,
        record_kind: 'error',
        error_status_code: 500,
        error_message: 'upstream failed',
      }],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })
    const wrapper = mount(UsageQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    expect(wrapper.findComponent(stubs.UsageTable).props('data')).toEqual([
      expect.objectContaining({ record_kind: 'error', error_status_code: 500 }),
    ])
  })

  it('uses selectable dates and keeps the start date before the end date', async () => {
    const wrapper = mount(UsageQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    const dateInputs = wrapper.findAll<HTMLInputElement>('input[type="date"]')
    expect(dateInputs).toHaveLength(2)

    await dateInputs[0].setValue('2026-10-21')
    await dateInputs[1].setValue('2026-10-20')
    expect(dateInputs[0].element.value).toBe('2026-10-20')

    await dateInputs[0].setValue('2026-10-25')
    expect(dateInputs[1].element.value).toBe('2026-10-25')
  })
})
