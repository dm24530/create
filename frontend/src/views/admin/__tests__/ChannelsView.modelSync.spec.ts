import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_PLATFORM_CATALOG,
  resetPlatformCatalog,
  setPlatformCatalog
} from '@/constants/platformCatalog'
import ChannelsView from '@/views/admin/ChannelsView.vue'

const { listChannels, getGroups, syncPricingModels, createChannel, updateChannel, showSuccess, showError } = vi.hoisted(() => ({
  listChannels: vi.fn(),
  getGroups: vi.fn(),
  syncPricingModels: vi.fn(),
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    channels: { list: listChannels, syncPricingModels, create: createChannel, update: updateChannel },
    groups: { getAll: getGroups },
    settings: { getWebSearchEmulationConfig: vi.fn().mockResolvedValue({ enabled: false }) }
  }
}))

vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess, showError }) }))

vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string) => key })
}))

function mountView(dataTableStub: unknown = true) {
  return mount(ChannelsView, {
    global: {
      stubs: {
        AppLayout: defineComponent({ template: '<main><slot /></main>' }),
        TablePageLayout: defineComponent({
          template: '<section><slot name="filters" /><slot name="table" /><slot name="pagination" /></section>'
        }),
        BaseDialog: defineComponent({
          props: ['show'],
          template: '<section v-if="show"><slot /><slot name="footer" /></section>'
        }),
        PricingEntryCard: defineComponent({
          props: ['entry'],
          emits: ['remove', 'update'],
          template: `<div class="pricing-entry">
            {{ entry.models.join(", ") }}
            <button class="fill-entry" aria-label="fill" @click="$emit('update', { ...entry, models: ['claude-sonnet-4-6'], billing_mode: 'token', input_price: 1, output_price: 2 })"></button>
            <button class="remove-entry" aria-label="remove" @click="$emit('remove')"></button>
          </div>`
        }),
        DataTable: dataTableStub,
        Pagination: true,
        ConfirmDialog: true,
        EmptyState: true,
        Select: true,
        Icon: true,
        PlatformIcon: true,
        Toggle: true
      }
    }
  })
}

async function openDialog(wrapper: ReturnType<typeof mountView>) {
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'admin.channels.createChannel')!.trigger('click')
  await flushPromises()
}

async function enablePlatform(wrapper: ReturnType<typeof mountView>, platform: string) {
  const label = wrapper.findAll('label').find(label => label.text() === `admin.groups.platforms.${platform}`)
  expect(label).toBeDefined()
  await label!.get('input[type="checkbox"]').setValue(true)
  await wrapper.findAll('button.channel-tab').find(button => button.text() === `admin.groups.platforms.${platform}`)!.trigger('click')
}

function visibleSyncButtons(wrapper: ReturnType<typeof mountView>) {
  return wrapper.findAll('button').filter(button => button.isVisible() && [
    'admin.channels.form.syncLatestModels',
    'admin.channels.form.syncingModels'
  ].includes(button.text()))
}

describe('ChannelsView pricing model sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    listChannels.mockResolvedValue({ items: [], total: 0 })
    getGroups.mockResolvedValue([])
    syncPricingModels.mockReset()
    createChannel.mockReset()
    createChannel.mockResolvedValue({ id: 99 })
    updateChannel.mockReset()
    updateChannel.mockResolvedValue({ id: 2 })
  })

  afterEach(() => {
    resetPlatformCatalog()
  })

  it.each([
    ['openai', true],
    ['opencode_go', true],
    ['typesafe', true],
    ['command_code', false],
    ['cline', false]
  ] as const)('offers pricing model sync for %s only when its pricing catalog exists', async (platform, expected) => {
    const wrapper = mountView()
    await openDialog(wrapper)
    await enablePlatform(wrapper, platform)

    expect(visibleSyncButtons(wrapper)).toHaveLength(expected ? 1 : 0)
    expect(syncPricingModels).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reacts to a new platform gaining a pricing catalog', async () => {
    const platform = { id: 'acme_router', display_name: 'Acme Router', gateway: 'openai' as const, cn_provider: false }
    setPlatformCatalog({
      ...BUILTIN_PLATFORM_CATALOG,
      platforms: [...BUILTIN_PLATFORM_CATALOG.platforms, platform]
    })
    const wrapper = mountView()
    await openDialog(wrapper)
    await enablePlatform(wrapper, platform.id)
    expect(visibleSyncButtons(wrapper)).toHaveLength(0)

    setPlatformCatalog({
      ...BUILTIN_PLATFORM_CATALOG,
      platforms: [...BUILTIN_PLATFORM_CATALOG.platforms, { ...platform, litellm_provider: 'acme' }]
    })
    await flushPromises()
    expect(visibleSyncButtons(wrapper)).toHaveLength(1)
    wrapper.unmount()
  })

  it('blocks additional syncs while one request is in flight and adds its models once', async () => {
    let resolveSync!: (value: { models: string[] }) => void
    syncPricingModels.mockReturnValue(new Promise(resolve => { resolveSync = resolve }))
    const wrapper = mountView()
    await openDialog(wrapper)
    await enablePlatform(wrapper, 'openai')
    await visibleSyncButtons(wrapper)[0].trigger('click')
    await visibleSyncButtons(wrapper)[0].trigger('click')
    await enablePlatform(wrapper, 'opencode_go')

    expect(visibleSyncButtons(wrapper)[0].attributes('disabled')).toBeDefined()
    await visibleSyncButtons(wrapper)[0].trigger('click')
    expect(syncPricingModels).toHaveBeenCalledOnce()
    expect(syncPricingModels).toHaveBeenCalledWith('openai')

    resolveSync({ models: ['gpt-latest'] })
    await flushPromises()
    expect(wrapper.findAll('.pricing-entry')).toHaveLength(1)
    expect(wrapper.get('.pricing-entry').text()).toBe('gpt-latest')
    expect(visibleSyncButtons(wrapper)[0].attributes('disabled')).toBeUndefined()
    expect(showError).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('creates a separate editable pricing entry for every synced model', async () => {
    syncPricingModels.mockResolvedValue({ models: ['gpt-image-a', 'gpt-image-b'] })
    const wrapper = mountView()
    await openDialog(wrapper)
    await enablePlatform(wrapper, 'openai')
    await visibleSyncButtons(wrapper)[0].trigger('click')
    await flushPromises()

    const entries = wrapper.findAll('.pricing-entry')
    expect(entries).toHaveLength(2)
    expect(entries.map(entry => entry.text())).toEqual(['gpt-image-a', 'gpt-image-b'])
    wrapper.unmount()
  })

  it('binds a composite group without enabling every concrete platform', async () => {
    getGroups.mockResolvedValue([
      { id: 3, name: '综合创作', platform: 'composite', rate_multiplier: 1, account_count: 6 }
    ])
    const wrapper = mountView()
    await openDialog(wrapper)

    expect(wrapper.findAll('button.channel-tab')).toHaveLength(1)
    const compositeGroup = wrapper.get('[data-testid="composite-group-3"]')
    await compositeGroup.setValue(true)
    expect(wrapper.get('[data-testid="composite-model-pricing"]')).toBeDefined()
    await wrapper.get('[data-testid="add-composite-pricing"]').trigger('click')
    expect(wrapper.findAll('[data-testid="composite-pricing-entry"]')).toHaveLength(1)
    await wrapper.get('[data-testid="composite-pricing-entry"] .fill-entry').trigger('click')
    await enablePlatform(wrapper, 'openai')
    expect((wrapper.get('[data-testid="platform-composite-group-3"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.findAll('button').filter(button => button.text() === 'admin.channels.form.syncLatestModels')).toHaveLength(0)
    await wrapper.get('#channel-form input[type="text"]').setValue('Composite channel')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()

    expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
      group_ids: [3],
      model_pricing: [expect.objectContaining({
        platform: 'anthropic',
        models: ['claude-sonnet-4-6'],
        billing_mode: 'token',
        input_price: 0.000001,
        output_price: 0.000002,
      })]
    }))
    wrapper.unmount()
  })

  it('does not submit stale composite pricing after the composite group is removed', async () => {
    getGroups.mockResolvedValue([
      { id: 3, name: '综合创作', platform: 'composite', rate_multiplier: 1, account_count: 6 }
    ])
    const wrapper = mountView()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="composite-group-3"]').setValue(true)
    await wrapper.get('[data-testid="add-composite-pricing"]').trigger('click')
    await wrapper.get('[data-testid="composite-pricing-entry"] .fill-entry').trigger('click')
    await wrapper.get('[data-testid="composite-group-3"]').setValue(false)
    await wrapper.get('#channel-form input[type="text"]').setValue('No composite channel')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()

    expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
      group_ids: [],
      model_pricing: [],
    }))
    wrapper.unmount()
  })

  it('moves platform pricing into composite pricing when a composite group is selected', async () => {
    getGroups.mockResolvedValue([
      { id: 3, name: '综合创作', platform: 'composite', rate_multiplier: 1, account_count: 6 }
    ])
    const wrapper = mountView()
    await openDialog(wrapper)
    await enablePlatform(wrapper, 'openai')
    await wrapper.get('[data-testid="add-platform-pricing-openai"]').trigger('click')
    await wrapper.get('.pricing-entry .fill-entry').trigger('click')
    expect(wrapper.findAll('.pricing-entry')).toHaveLength(1)

    await wrapper.get('[data-testid="platform-composite-group-3"]').setValue(true)
    expect(wrapper.findAll('[data-testid="composite-pricing-entry"]')).toHaveLength(1)
    expect(wrapper.findAll('.pricing-entry')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps account stats rules when editing a composite channel without mappings or primary pricing', async () => {
    getGroups.mockResolvedValue([
      { id: 3, name: '综合创作', platform: 'composite', rate_multiplier: 1, account_count: 6 }
    ])
    listChannels.mockResolvedValue({
      items: [{
        id: 2,
        name: 'Composite channel',
        description: '',
        status: 'active',
        group_ids: [3],
        model_pricing: [],
        model_mapping: {},
        billing_model_source: 'channel_mapped',
        restrict_models: false,
        features_config: {},
        apply_pricing_to_account_stats: false,
        account_stats_pricing_rules: [{
          name: 'rule',
          group_ids: [3],
          account_ids: [],
          pricing: [{
            platform: 'anthropic',
            models: ['claude-sonnet-4-6'],
            billing_mode: 'token',
            input_price: 0.000001,
            output_price: 0.000002,
            intervals: [],
          }],
        }],
      }],
      total: 1,
    })
    const DataTableStub = defineComponent({
      props: ['data'],
      template: '<div><slot v-for="row in data" :key="row.id" name="cell-actions" :row="row" /></div>',
    })
    const wrapper = mountView(DataTableStub)
    await flushPromises()
    const editButton = wrapper.findAll('button').find(button => button.text().includes('common.edit'))
    expect(editButton).toBeDefined()
    await editButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.findAll('button.channel-tab').map(button => button.text())).toContain('admin.groups.platforms.anthropic')
    await wrapper.get('#channel-form').trigger('submit')
    await flushPromises()
    expect(updateChannel).toHaveBeenCalledWith(2, expect.objectContaining({
      account_stats_pricing_rules: [expect.objectContaining({
        name: 'rule',
        group_ids: [3],
        pricing: [expect.objectContaining({
          platform: 'anthropic',
          models: ['claude-sonnet-4-6'],
        })],
      })],
    }))
    wrapper.unmount()
  })
})
