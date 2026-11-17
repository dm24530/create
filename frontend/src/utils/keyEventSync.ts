import { keysAPI } from '@/api'
import {
  KEYS_CHANGED_EVENT,
  notifyCreatorKeyChanged,
  type CreatorKeyKind,
} from './creatorKeyEvents'

let controller: AbortController | null = null
let stopped = true
let retryTimer: number | null = null

function notifyKeyChange(kind: CreatorKeyKind, keyId: string) {
  notifyCreatorKeyChanged(kind, keyId || 'remote-key-sync')
}

function dispatchKeysChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(KEYS_CHANGED_EVENT))
  notifyKeyChange('image', 'remote-key-sync')
  notifyKeyChange('video', 'remote-key-sync')
}

export function startKeyEventSync() {
  stopKeyEventSync()
  stopped = false
  void runLoop()
}

export function stopKeyEventSync() {
  stopped = true
  controller?.abort()
  controller = null
  if (retryTimer != null) {
    window.clearTimeout(retryTimer)
    retryTimer = null
  }
}

async function runLoop() {
  while (!stopped) {
    const activeController = new AbortController()
    controller = activeController
    try {
      await keysAPI.watchEvents({
        signal: activeController.signal,
        onEvent: () => dispatchKeysChanged(),
      })
    } catch (error) {
      if (stopped || activeController.signal.aborted) return
      console.warn('API key event stream disconnected:', error)
    } finally {
      if (controller === activeController) controller = null
    }
    if (stopped) return
    await new Promise<void>((resolve) => {
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        resolve()
      }, 3000)
    })
  }
}
