import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiKey, Group } from '@/types'
import { ensureCreatorKey } from '../useCreatorKey'

const { listKeys, createKey, getAvailableGroups } = vi.hoisted(() => ({
  listKeys: vi.fn(),
  createKey: vi.fn(),
  getAvailableGroups: vi.fn(),
}))

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
    create: createKey,
  },
  userGroupsAPI: {
    getAvailable: getAvailableGroups,
  },
}))

function group(overrides: Partial<Group> & Pick<Group, 'id' | 'name' | 'platform'>): Group {
  return {
    description: null,
    rate_multiplier: 1,
    is_exclusive: false,
    status: 'active',
    subscription_type: 'standard',
    allow_image_generation: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Group
}

function key(
  overrides: Partial<ApiKey> & Pick<ApiKey, 'id' | 'name' | 'key' | 'group_id' | 'group'>,
): ApiKey {
  return {
    user_id: 1,
    status: 'active',
    ip_whitelist: [],
    ip_blacklist: [],
    last_used_at: null,
    last_used_ip: null,
    quota: 0,
    quota_used: 0,
    expires_at: null,
    created_at: '',
    updated_at: '',
    current_concurrency: 0,
    rate_limit_5h: 0,
    rate_limit_1d: 0,
    rate_limit_7d: 0,
    usage_5h: 0,
    usage_1d: 0,
    usage_7d: 0,
    window_5h_start: null,
    window_1d_start: null,
    window_7d_start: null,
    reset_5h_at: null,
    reset_1d_at: null,
    reset_7d_at: null,
    ...overrides,
  } as ApiKey
}

describe('ensureCreatorKey', () => {
  beforeEach(() => {
    listKeys.mockReset()
    createKey.mockReset()
    getAvailableGroups.mockReset()
  })

  it('reuses an existing composite key without asking for groups', async () => {
    const composite = group({
      id: 3,
      name: '综合创作',
      platform: 'composite',
      allow_image_generation: true,
    })
    const compositeKey = key({
      id: 9,
      name: '创作密钥',
      key: 'sk-composite',
      group_id: 3,
      group: composite,
    })
    listKeys.mockResolvedValue({ items: [compositeKey], total: 1 })

    const result = await ensureCreatorKey('image')

    expect(result.key).toBe(compositeKey)
    expect(getAvailableGroups).not.toHaveBeenCalled()
    expect(createKey).not.toHaveBeenCalled()
  })

  it('creates a composite key when the user only has a provider-bound key', async () => {
    const openai = group({
      id: 2,
      name: '生图',
      platform: 'openai',
      allow_image_generation: true,
    })
    const composite = group({
      id: 3,
      name: '综合创作',
      platform: 'composite',
      allow_image_generation: true,
    })
    const openaiKey = key({
      id: 1,
      name: '图片',
      key: 'sk-openai',
      group_id: 2,
      group: openai,
    })
    const compositeKey = key({
      id: 10,
      name: '创作密钥',
      key: 'sk-composite',
      group_id: 3,
      group: composite,
    })
    listKeys.mockResolvedValue({ items: [openaiKey], total: 1 })
    getAvailableGroups.mockResolvedValue([openai, composite])
    createKey.mockResolvedValue(compositeKey)

    const result = await ensureCreatorKey('image')

    expect(createKey).toHaveBeenCalledWith('创作密钥', 3)
    expect(result.key).toBe(compositeKey)
    expect(result.keys).toContain(openaiKey)
    expect(result.keys).toContain(compositeKey)
  })

  it('uses an existing creative key when no composite group is available', async () => {
    const openai = group({
      id: 2,
      name: '生图',
      platform: 'openai',
      allow_image_generation: true,
    })
    const openaiKey = key({
      id: 1,
      name: '图片',
      key: 'sk-openai',
      group_id: 2,
      group: openai,
    })
    listKeys.mockResolvedValue({ items: [openaiKey], total: 1 })
    getAvailableGroups.mockResolvedValue([openai])

    const result = await ensureCreatorKey('image')

    expect(result.key).toBe(openaiKey)
    expect(createKey).not.toHaveBeenCalled()
  })

  it('rejects when the user has no creative service available', async () => {
    const textOnly = group({
      id: 1,
      name: '文本',
      platform: 'anthropic',
      allow_image_generation: false,
    })
    listKeys.mockResolvedValue({ items: [], total: 0 })
    getAvailableGroups.mockResolvedValue([textOnly])

    await expect(ensureCreatorKey('image')).rejects.toThrow('NO_IMAGE_CREATION_SERVICE')
    expect(createKey).not.toHaveBeenCalled()
  })
})
