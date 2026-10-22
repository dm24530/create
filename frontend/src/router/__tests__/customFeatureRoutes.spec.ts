import { describe, expect, it } from 'vitest'

import {
  adminCustomFeatureRoutesAfterAnnouncements,
  adminCustomFeatureRoutesAfterSettings,
  publicCustomFeatureRoutes,
  userCustomFeatureRoutesAfterAvailableChannels,
  userCustomFeatureRoutesAfterKeys,
  userCustomFeatureRoutesAfterRedeem,
} from '../customFeatureRoutes'
import { routes } from '../index'

function expectPathOrder(paths: string[], orderedPaths: string[]) {
  const indexes = orderedPaths.map((path) => paths.indexOf(path))
  expect(indexes.every((index) => index >= 0)).toBe(true)
  expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
}

describe('custom feature routes', () => {
  it('does not keep the retired public models route registered', () => {
    expect(publicCustomFeatureRoutes).toEqual([])
  })

  it('keeps user custom routes registered at stable insertion points', () => {
    expect(userCustomFeatureRoutesAfterKeys.map((route) => route.path)).toEqual([
      '/playground',
      '/image-studio',
      '/canvas',
      '/canvas/:projectId',
      '/video-studio',
      '/video-inspiration',
      '/image-inspiration',
      '/video-works',
    ])
    expect(userCustomFeatureRoutesAfterRedeem.map((route) => route.path)).toEqual(['/lottery'])
    expect(userCustomFeatureRoutesAfterAvailableChannels.map((route) => route.path)).toEqual([
      '/manual',
      '/manual/:platform',
      '/docs/api',
      '/models',
    ])
  })

  it('keeps admin custom routes registered at stable insertion points', () => {
    expect(adminCustomFeatureRoutesAfterAnnouncements.map((route) => route.path)).toEqual(['/admin/lottery'])
    expect(adminCustomFeatureRoutesAfterSettings.map((route) => route.path)).toEqual(['/admin/upstream-monitor'])
  })

  it('keeps the user studio navigation horizontal on every studio page', () => {
    const studioPaths = new Set([
      '/image-studio',
      '/video-studio',
      '/image-inspiration',
      '/video-inspiration',
      '/video-works',
    ])
    const studioRoutes = userCustomFeatureRoutesAfterKeys.filter((route) => studioPaths.has(route.path))

    expect(studioRoutes).toHaveLength(studioPaths.size)
    expect(studioRoutes.every((route) => route.meta?.immersive === true)).toBe(true)
  })

  it('mounts custom routes in the main router at stable positions', () => {
    const paths = routes.map((route) => route.path)

    expectPathOrder(paths, ['/key-usage', '/legal/:documentId'])
    expectPathOrder(paths, [
      '/keys',
      '/playground',
      '/image-studio',
      '/video-studio',
      '/video-inspiration',
      '/image-inspiration',
      '/video-works',
      '/usage',
    ])
    expectPathOrder(paths, ['/redeem', '/lottery', '/affiliate'])
    expectPathOrder(paths, ['/available-channels', '/manual', '/manual/:platform', '/docs/api', '/models', '/profile'])
    expectPathOrder(paths, ['/admin/announcements', '/admin/lottery', '/admin/proxies'])
    expectPathOrder(paths, ['/admin/settings', '/admin/upstream-monitor', '/admin/risk-control'])
  })
})
