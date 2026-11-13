<template>
  <AppLayout>
    <div class="canvas-host" :class="{ 'canvas-host--dark': isDark }">
      <iframe
        v-if="frameURL"
        ref="frameRef"
        :src="frameURL"
        class="canvas-host__frame"
        allow="clipboard-read; clipboard-write; fullscreen"
        @load="handleFrameLoad"
      />
      <div v-if="error" class="canvas-host__error canvas-host__error--overlay">
        <h1>画布加载失败</h1>
        <p>{{ error }}</p>
        <button type="button" @click="loadContext()">重试</button>
      </div>
      <div
        v-else-if="!frameURL || !frameReady"
        class="canvas-host__loading canvas-host__loading--overlay"
      >
        <span class="canvas-host__spinner" />
        <p>{{ frameLoaded ? '正在启动无限画布...' : '正在加载无限画布...' }}</p>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { authAPI, keysAPI } from '@/api'
import AppLayout from '@/components/layout/AppLayout.vue'
import { useTheme } from '@/composables/useTheme'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'
import { onCreatorKeyChanged } from '@/utils/creatorKeyEvents'
import { useAuthStore } from '@/stores/auth'
import {
  canvasChannelName,
  selectCanvasCreatorKey,
  selectCanvasVideoCreatorKey,
} from './creatorKeySelection'
import {
  canvasPathFromVueRoute,
  isCanvasRoutePath,
  normalizeCanvasRoutePath,
} from './canvasRouteSync'

const loading = ref(true)
const error = ref('')
const frameRef = ref<HTMLIFrameElement | null>(null)
const frameLoaded = ref(false)
const frameReady = ref(false)
const frameBaseURL = ref('')
const frameStorageScope = ref('')
const bootstrapPayload = ref<{
  baseUrl: string
  apiKey: string
  videoApiKey: string
  accessToken: string
  channelName: string
  videoChannelName: string
  locale: 'zh-CN' | 'en-US'
} | null>(null)
const bootstrapTimers: number[] = []
let frameReadyFallbackTimer: number | undefined
let canvasContextRequestID = 0
let unsubscribeCreatorKeyChanged: (() => void) | undefined
let lastFrameCanvasPath = ''
const { isDark } = useTheme()
const { locale } = useI18n()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
watch(
  () => authStore.user?.id,
  (userID, previousUserID) => {
    frameStorageScope.value = userID == null ? '' : resolveCanvasStorageScope(userID)
    if (previousUserID === undefined || String(previousUserID ?? '') === String(userID ?? '')) return
    clearBootstrapTimers()
    frameLoaded.value = false
    frameReady.value = false
    bootstrapPayload.value = null
    error.value = ''
    if (userID != null) void loadContext()
  },
  { immediate: true },
)
const frameURL = computed(() => {
  const userID = String(authStore.user?.id || '').trim()
  if (!frameBaseURL.value || !userID) return frameBaseURL.value
  const url = new URL(frameBaseURL.value, window.location.origin)
  url.searchParams.set('user', userID)
  if (frameStorageScope.value) {
    url.searchParams.set('scope', frameStorageScope.value)
  }
  if (url.origin === window.location.origin) {
    return `${url.pathname}${url.search}${url.hash}`
  }
  return url.toString()
})
const canvasLocale = computed<'zh-CN' | 'en-US'>(() => (
  locale.value.startsWith('zh') ? 'zh-CN' : 'en-US'
))

const frameOrigin = computed(() => (
  frameURL.value ? new URL(frameURL.value, window.location.origin).origin : window.location.origin
))

function resolveCanvasStorageScope(userID: number | string) {
  const storageKey = `sub2api:canvas-local-scope:${userID}`
  try {
    const existing = localStorage.getItem(storageKey)
    if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing
    const generated = randomStorageScope()
    localStorage.setItem(storageKey, generated)
    return generated
  } catch {
    return randomStorageScope()
  }
}

function randomStorageScope() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function resolveFrameURL() {
  // The parent Vite server already serves the built canvas at /canvas-app and
  // falls back to its SPA entry. Only use the separate canvas dev server when
  // explicitly requested, otherwise port 3001 may belong to another app.
  const canvasPath = currentCanvasPath() || '/canvas'
  const baseURL = import.meta.env.DEV && import.meta.env.VITE_CANVAS_SOURCE_DEV === '1'
    ? 'http://localhost:3001'
    : '/canvas-app'
  const url = new URL(`${baseURL}${canvasPath}`, window.location.origin)
  url.searchParams.set('embed', '1')
  frameBaseURL.value = url.toString()
}

async function loadContext(options: { preserveFrame?: boolean } = {}) {
  const requestID = ++canvasContextRequestID
  const ownerID = String(authStore.user?.id || '')
  const isCurrentRequest = () => (
    requestID === canvasContextRequestID &&
    ownerID === String(authStore.user?.id || '')
  )
  loading.value = true
  error.value = ''
  if (!options.preserveFrame) {
    frameLoaded.value = false
    frameReady.value = false
  }
  bootstrapPayload.value = null
  try {
    const [settings, keyResponse] = await loadCanvasContextWithRetry()
    const resolved = resolvePlaygroundApiEndpoint(
      settings.api_base_url || '',
      window.location.hostname,
    )
    if (!isCurrentRequest()) return
    const creatorKey = selectCanvasCreatorKey(keyResponse.items || [], localStorage, ownerID)
    const videoCreatorKey = selectCanvasVideoCreatorKey(keyResponse.items || [], localStorage, ownerID)
    const baseURL = import.meta.env.DEV
      ? '/v1'
      : new URL(resolved, window.location.origin).toString().replace(/\/+$/, '')
    bootstrapPayload.value = {
      baseUrl: baseURL,
      apiKey: creatorKey?.key || '',
      videoApiKey: videoCreatorKey?.key || '',
      accessToken: authStore.token || '',
      channelName: creatorKey ? canvasChannelName(creatorKey) : '',
      videoChannelName: videoCreatorKey ? canvasChannelName(videoCreatorKey) : '',
      locale: canvasLocale.value,
    }
  } catch (cause) {
    if (!isCurrentRequest()) return
    error.value = canvasContextErrorMessage(cause)
  } finally {
    if (isCurrentRequest()) loading.value = false
  }
}

async function loadCanvasContextWithRetry() {
  let lastError: unknown
  for (const delay of [0, 800, 2000]) {
    if (delay > 0) await wait(delay)
    try {
      return await Promise.all([
        authAPI.getPublicSettings(),
        keysAPI.list(1, 100, { status: 'active' }),
      ])
    } catch (cause) {
      lastError = cause
      if (!isRetryableCanvasContextError(cause)) throw cause
    }
  }
  throw lastError
}

function wait(delay: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay))
}

function isRetryableCanvasContextError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause || '')
  return /failed to fetch|network error|load failed|fetch failed/i.test(message)
}

function canvasContextErrorMessage(cause: unknown) {
  if (isRetryableCanvasContextError(cause)) {
    return '网络连接失败，画布服务暂时不可用。通常是后端正在重启或源站返回 502，请稍后重试。'
  }
  return cause instanceof Error ? cause.message : '无法准备画布密钥'
}

function clearBootstrapTimers() {
  for (const timer of bootstrapTimers.splice(0)) window.clearTimeout(timer)
}

function postTheme() {
  if (!frameRef.value?.contentWindow) return
  frameRef.value.contentWindow.postMessage({
    type: 'create-canvas-theme',
    theme: isDark.value ? 'dark' : 'light',
  }, frameOrigin.value)
}

function postLocale() {
  if (!frameRef.value?.contentWindow) return
  frameRef.value.contentWindow.postMessage({
    type: 'create-canvas-locale',
    locale: canvasLocale.value,
  }, frameOrigin.value)
}

function postCanvasNavigate(path: string) {
  if (!frameRef.value?.contentWindow || !path) return
  frameRef.value.contentWindow.postMessage({
    type: 'create-canvas-navigate',
    path,
  }, frameOrigin.value)
}

function sendBootstrap() {
  if (!frameLoaded.value || !bootstrapPayload.value || !frameRef.value?.contentWindow) return
  const payload = {
    type: 'create-canvas-bootstrap',
    ...bootstrapPayload.value,
    managed: true,
    theme: isDark.value ? 'dark' : 'light',
  }
  clearBootstrapTimers()
  for (const delay of [0, 250, 750, 1500, 3000]) {
    bootstrapTimers.push(window.setTimeout(() => {
      frameRef.value?.contentWindow?.postMessage(payload, frameOrigin.value)
    }, delay))
  }
}

function handleFrameLoad() {
  frameLoaded.value = true
  frameReady.value = false
  if (frameReadyFallbackTimer) window.clearTimeout(frameReadyFallbackTimer)
  frameReadyFallbackTimer = window.setTimeout(() => {
    frameReady.value = true
  }, 1800)
  sendBootstrap()
}

function currentCanvasPath() {
  return canvasPathFromVueRoute(route.path, route.params.id, route.query, route.hash)
}

function handleFrameMessage(event: MessageEvent<{ type?: string; path?: string }>) {
  if (event.source !== frameRef.value?.contentWindow) return
  if (event.data?.type === 'create-canvas-ready') {
    if (frameReadyFallbackTimer) window.clearTimeout(frameReadyFallbackTimer)
    frameReady.value = true
    return
  }
  if (event.data?.type !== 'create-canvas-route') return
  const path = normalizeCanvasRoutePath(String(event.data.path || ''))
  if (!path) return
  lastFrameCanvasPath = path
  if (path !== currentCanvasPath()) void router.push(path)
}

onMounted(() => {
  window.addEventListener('message', handleFrameMessage)
  unsubscribeCreatorKeyChanged = onCreatorKeyChanged(() => {
    void loadContext({ preserveFrame: true })
  })
  void Promise.all([resolveFrameURL(), loadContext()])
})
onUnmounted(() => {
  window.removeEventListener('message', handleFrameMessage)
  unsubscribeCreatorKeyChanged?.()
  if (frameReadyFallbackTimer) window.clearTimeout(frameReadyFallbackTimer)
  clearBootstrapTimers()
})
watch(isDark, postTheme)
watch(canvasLocale, postLocale)
watch(bootstrapPayload, sendBootstrap)
watch(
  () => currentCanvasPath(),
  (path) => {
    if (!path || !isCanvasRoutePath(route.path) || !frameLoaded.value) return
    if (path === lastFrameCanvasPath) return
    postCanvasNavigate(path)
  },
)
watch(() => authStore.token, (token) => {
  if (!bootstrapPayload.value || !token) return
  bootstrapPayload.value = {
    ...bootstrapPayload.value,
    accessToken: token,
  }
})
</script>

<style scoped>
.canvas-host {
  --canvas-host-bg: #f7f7f5;
  --canvas-host-text: #292524;
  --canvas-host-muted: #78716c;
  --canvas-host-error: #1c1917;
  position: relative;
  height: calc(100vh - 3.5rem);
  min-height: 620px;
  overflow: hidden;
  background: var(--canvas-host-bg);
}

.canvas-host--dark {
  --canvas-host-bg: #0c0f14;
  --canvas-host-text: #e7e5e4;
  --canvas-host-muted: #94a3b8;
  --canvas-host-error: #f8fafc;
}

.canvas-host__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--canvas-host-bg);
}

.canvas-host__loading,
.canvas-host__error {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--canvas-host-bg);
  color: var(--canvas-host-text);
  text-align: center;
}

.canvas-host__loading--overlay {
  position: absolute;
  z-index: 1;
  inset: 0;
}

.canvas-host__error--overlay {
  position: absolute;
  z-index: 2;
  top: 1rem;
  left: 50%;
  width: min(32rem, calc(100% - 2rem));
  height: auto;
  padding: 1rem 1.25rem;
  border: 1px solid rgb(248 113 113 / 0.45);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--canvas-host-bg) 96%, transparent);
  box-shadow: 0 12px 36px rgb(15 23 42 / 0.16);
  transform: translateX(-50%);
}

.canvas-host__loading p,
.canvas-host__error p {
  max-width: 520px;
  color: var(--canvas-host-muted);
  font-size: 13px;
}

.canvas-host__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid rgb(148 163 184 / 0.2);
  border-top-color: #fb923c;
  border-radius: 999px;
  animation: canvas-host-spin 0.8s linear infinite;
}

.canvas-host__error h1 {
  color: var(--canvas-host-error);
  font-size: 18px;
  font-weight: 650;
}

.canvas-host__error button {
  margin-top: 4px;
  border-radius: 7px;
  background: #fb923c;
  padding: 8px 14px;
  color: #111827;
  font-size: 12px;
  font-weight: 700;
}

@keyframes canvas-host-spin {
  to { transform: rotate(360deg); }
}
</style>
