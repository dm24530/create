import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiKeyQuickModal from '../ApiKeyQuickModal.vue'

const { listKeys, createKey, updateKey, deleteKey, getAvailableGroups, copyToClipboard } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  createKey: vi.fn(),
  updateKey: vi.fn(),
  deleteKey: vi.fn(),
  getAvailableGroups: vi.fn(),
  copyToClipboard: vi.fn(),
}))

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
    create: createKey,
    update: updateKey,
    delete: deleteKey,
  },
  userGroupsAPI: {
    getAvailable: getAvailableGroups,
  },
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard }),
}))

const stubs = {
  BaseDialog: {
    props: ['show', 'title', 'closeOnClickOutside'],
    emits: ['close'],
    template:
      '<div v-if="show"><button v-if="closeOnClickOutside" data-testid="key-backdrop" @click="$emit(\'close\')">backdrop</button><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
  },
  ConfirmDialog: {
    props: ['show', 'title', 'message'],
    emits: ['confirm', 'cancel'],
    template: '<button v-if="show" data-testid="confirm-delete" @click="$emit(\'confirm\')">{{ message }}</button>',
  },
  Icon: true,
}

const key = {
  id: 7,
  name: '创作密钥',
  key: 'sk-created-secret',
  status: 'active',
  group_id: 3,
  quota: 0,
  quota_used: 0,
  rate_limit_5h: 0,
  rate_limit_1d: 0,
  rate_limit_7d: 0,
  group: { id: 3, name: '综合创作', platform: 'composite' },
}

describe('ApiKeyQuickModal', () => {
  beforeEach(() => {
    listKeys.mockReset().mockResolvedValue({ items: [key] })
    createKey.mockReset().mockResolvedValue({ ...key, id: 8, name: '创作密钥 2' })
    updateKey.mockReset().mockResolvedValue(key)
    deleteKey.mockReset().mockResolvedValue({ message: 'deleted' })
    getAvailableGroups.mockReset().mockResolvedValue([
      { id: 2, name: '普通分组', platform: 'standard' },
      { id: 3, name: '综合创作', platform: 'composite' },
    ])
    copyToClipboard.mockReset().mockResolvedValue(true)
  })

  it('creates a key inside the modal without navigating away', async () => {
    const wrapper = mount(ApiKeyQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.get('[data-testid="api-key-create-toggle"]').trigger('click')
    expect(wrapper.text()).toContain('正在创建新密钥')
    expect(wrapper.get('[data-testid="api-key-quota"]').attributes('placeholder')).toBe('留空则不限制额度')
    await wrapper.get('[data-testid="api-key-name"]').setValue('生图专用')
    await wrapper.get('[data-testid="api-key-group"]').setValue('2')
    await wrapper.get('[data-testid="api-key-quota"]').setValue('20')
    await wrapper.get('[data-testid="api-key-save"]').trigger('click')
    await flushPromises()

    expect(getAvailableGroups).toHaveBeenCalled()
    expect(createKey).toHaveBeenCalledWith(
      '生图专用',
      2,
      undefined,
      undefined,
      undefined,
      20,
      undefined,
      {
        rate_limit_5h: undefined,
        rate_limit_1d: undefined,
        rate_limit_7d: undefined,
      },
    )
    expect(wrapper.text()).not.toContain('创建 / 管理密钥')
  })

  it('edits the name, group and quota in the same modal', async () => {
    const wrapper = mount(ApiKeyQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.get('[aria-label="编辑 创作密钥"]').trigger('click')
    expect(wrapper.text()).toContain('正在编辑已有密钥')
    expect(wrapper.text()).toContain('创作密钥 ·')
    await wrapper.get('[data-testid="api-key-name"]').setValue('生图密钥')
    await wrapper.get('[data-testid="api-key-group"]').setValue('2')
    await wrapper.get('[data-testid="api-key-quota"]').setValue('12.5')
    await wrapper.get('[data-testid="api-key-save"]').trigger('click')
    await flushPromises()

    expect(updateKey).toHaveBeenCalledWith(7, {
      name: '生图密钥',
      group_id: 2,
      quota: 12.5,
      rate_limit_5h: 0,
      rate_limit_1d: 0,
      rate_limit_7d: 0,
    })
  })

  it('closes when the backdrop is clicked', async () => {
    const wrapper = mount(ApiKeyQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.get('[data-testid="key-backdrop"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('deletes a key after confirmation inside the modal', async () => {
    const wrapper = mount(ApiKeyQuickModal, {
      props: { show: true },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.get('[aria-label="删除 创作密钥"]').trigger('click')
    expect(wrapper.get('[data-testid="confirm-delete"]').text()).toContain('删除后无法恢复')
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    expect(deleteKey).toHaveBeenCalledWith(7)
  })
})
