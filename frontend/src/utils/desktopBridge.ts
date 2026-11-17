export type DesktopBridge = {
  isDesktop: true
  getRuntime: () => Promise<{
    isDesktop: boolean
    platform: string
    version: string
    packaged: boolean
  }>
  openSettings: () => Promise<void>
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null
  const bridge = (window as Window & { createDesktop?: DesktopBridge }).createDesktop
  return bridge?.isDesktop === true ? bridge : null
}

export async function openDesktopSaveSettings(): Promise<boolean> {
  const bridge = getDesktopBridge()
  if (!bridge) return false
  await bridge.openSettings()
  return true
}
