import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import AuthLayout from '../AuthLayout.vue'

vi.mock('@/stores', () => ({
  useAppStore: () => ({
    siteName: 'Create',
    siteLogo: '/logo.svg',
    publicSettingsLoaded: true,
    cachedPublicSettings: { site_subtitle: 'AI 视频与图片生成平台' },
    fetchPublicSettings: vi.fn(),
  }),
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

const stubs = {
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  LocaleSwitcher: true,
  Icon: true,
}

describe('AuthLayout', () => {
  it('renders only the split layout when split variant is selected', () => {
    const wrapper = mount(AuthLayout, {
      props: { variant: 'split' },
      slots: { default: '<div data-testid="auth-content">Login</div>' },
      global: { stubs },
    })

    expect(wrapper.findAll('.auth-split-shell')).toHaveLength(1)
    expect(wrapper.findAll('.card-glass')).toHaveLength(0)
    expect(wrapper.get('[data-testid="auth-content"]').text()).toBe('Login')
  })

  it('renders only the centered layout for the default variant', () => {
    const wrapper = mount(AuthLayout, {
      slots: { default: '<div data-testid="auth-content">Login</div>' },
      global: { stubs },
    })

    expect(wrapper.findAll('.auth-split-shell')).toHaveLength(0)
    expect(wrapper.findAll('.card-glass')).toHaveLength(1)
    expect(wrapper.get('[data-testid="auth-content"]').text()).toBe('Login')
  })
})
