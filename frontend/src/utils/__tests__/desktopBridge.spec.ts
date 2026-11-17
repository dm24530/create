import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDesktopBridge, openDesktopSaveSettings } from '../desktopBridge'

describe('desktopBridge', () => {
  afterEach(() => {
    delete (window as Window & { createDesktop?: unknown }).createDesktop
  })

  it('stays inactive in a normal browser', async () => {
    expect(getDesktopBridge()).toBeNull()
    await expect(openDesktopSaveSettings()).resolves.toBe(false)
  })

  it('uses the desktop bridge when the Electron preload is present', async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined)
    ;(window as Window & { createDesktop?: unknown }).createDesktop = {
      isDesktop: true,
      openSettings,
    }

    expect(getDesktopBridge()?.isDesktop).toBe(true)
    await expect(openDesktopSaveSettings()).resolves.toBe(true)
    expect(openSettings).toHaveBeenCalledOnce()
  })
})
