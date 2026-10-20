import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'

import LandingPage from '../LandingPage.vue'

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

function mountPage(overrides: Partial<{
  isAuthenticated: boolean
  showModelPlazaEntry: boolean
}> = {}) {
  return mount(LandingPage, {
    props: {
      siteName: 'Create',
      siteSubtitle: 'AI Video & Image Generation Platform',
      docUrl: '',
      isAuthenticated: false,
      dashboardPath: '/dashboard',
      showModelPlazaEntry: false,
      ...overrides,
    },
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        LocaleSwitcher: true,
        Icon: true,
      },
    },
  })
}

describe('LandingPage', () => {
  it('renders the navigation brand as text only', () => {
    const wrapper = mountPage()
    const brand = wrapper.get('.landing-brand')

    expect(brand.text()).toBe('Create')
    expect(brand.find('.landing-brand-mark').exists()).toBe(false)
  })

  it('renders the editorial hero, gallery and story sections', () => {
    const wrapper = mountPage()

    expect(wrapper.get('.landing-hero img').attributes('src')).toBe('/landing/hero-stars-1280.webp')
    expect(wrapper.get('.landing-hero img').attributes('srcset')).toContain('640w')
    expect(wrapper.get('.landing-hero img').attributes('srcset')).toContain('2560w')
    expect(wrapper.get('.landing-hero img').attributes('srcset')).not.toContain('7680w')
    expect(wrapper.get('.landing-hero img').attributes('sizes')).toBe('100vw')
    expect(wrapper.findAll('.landing-hero-art')).toHaveLength(1)
    expect(wrapper.findAll('.landing-art-piece')).toHaveLength(5)
    expect(wrapper.findAll('.landing-recipe-row')).toHaveLength(3)
    expect(wrapper.text()).toContain('home.landing.titleAccent')
  })

  it('switches the hero image from the manual slide controls', async () => {
    const wrapper = mountPage()
    const dots = wrapper.findAll('.landing-hero-dot')

    let slides = wrapper.findAll('.landing-hero-art')
    expect(slides[0].classes()).toContain('is-active')
    expect(dots).toHaveLength(3)

    await dots[1].trigger('click')

    slides = wrapper.findAll('.landing-hero-art')
    expect(slides).toHaveLength(2)
    expect(slides[1].classes()).toContain('is-active')
    expect(wrapper.get('.landing-hero-count').text()).toContain('02 / 03')
  })

  it('sends unauthenticated visitors to login from the primary actions', () => {
    const wrapper = mountPage()
    const links = wrapper.findAllComponents(RouterLinkStub)

    expect(links.filter((link) => link.props('to') === '/login').length).toBeGreaterThanOrEqual(2)
  })

  it('uses studio and dashboard destinations after sign in', () => {
    const wrapper = mountPage({ isAuthenticated: true })
    const destinations = wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))

    expect(destinations).toContain('/image-studio')
    expect(destinations).toContain('/video-studio')
    expect(destinations).toContain('/dashboard')
  })
})
