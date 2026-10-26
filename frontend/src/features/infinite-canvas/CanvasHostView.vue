<template>
  <AppLayout>
    <div class="canvas-host" :class="{ 'canvas-host--dark': isDark }">
      <div v-if="error" class="canvas-host__error">
        <h1>画布加载失败</h1>
        <p>{{ error }}</p>
        <button type="button" @click="loadContext">重试</button>
      </div>

      <template v-else>
        <iframe
          v-if="frameURL"
          ref="frameRef"
          :src="frameURL"
          class="canvas-host__frame"
          allow="clipboard-read; clipboard-write; fullscreen"
          @load="handleFrameLoad"
        />
        <div v-if="!frameURL || loading || !frameReady" class="canvas-host__loading canvas-host__loading--overlay">
          <span class="canvas-host__spinner" />
          <p>{{ loading ? '正在加载无限画布...' : '正在启动无限画布...' }}</p>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { authAPI, keysAPI } from '@/api'
import AppLayout from '@/components/layout/AppLayout.vue'
import { useTheme } from '@/composables/useTheme'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'
import { useAuthStore } from '@/stores/auth'
import { canvasChannelName, selectCanvasCreatorKey } from './creatorKeySelection'

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
  accessToken: string
  channelName: string
  locale: 'zh-CN' | 'en-US'
} | null>(null)
const bootstrapTimers: number[] = []
let frameReadyFallbackTimer: number | undefined
let canvasContextRequestID = 0
const { isDark } = useTheme()
const { locale } = useI18n()
const authStore = useAuthStore()
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
  const separator = frameBaseURL.value.includes('?') ? '&' : '?'
  const scope = frameStorageScope.value
    ? `&scope=${encodeURIComponent(frameStorageScope.value)}`
    : ''
  return `${frameBaseURL.value}${separator}user=${encodeURIComponent(userID)}${scope}`
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
  if (!import.meta.env.DEV) {
    frameBaseURL.value = '/canvas-app/canvas?embed=1'
    return
  }

  if (import.meta.env.VITE_CANVAS_SOURCE_DEV === '1') {
    frameBaseURL.value = 'http://localhost:3001/canvas?embed=1'
    return
  }

  try {
    const response = await fetch('http://localhost:3001/canvas-app/index.html', {
      method: 'HEAD',
      cache: 'no-store',
    })
    frameBaseURL.value = response.ok
      ? 'http://localhost:3001/canvas-app/canvas?embed=1'
      : 'http://localhost:3001/canvas?embed=1'
  } catch {
    frameBaseURL.value = 'http://localhost:3001/canvas?embed=1'
  }
}

async function loadContext() {
  const requestID = ++canvasContextRequestID
  const ownerID = String(authStore.user?.id || '')
  const isCurrentRequest = () => (
    requestID === canvasContextRequestID &&
    ownerID === String(authStore.user?.id || '')
  )
  loading.value = true
  error.value = ''
  frameLoaded.value = false
  frameReady.value = false
  bootstrapPayload.value = null
  try {
    const [settings, keyResponse] = await Promise.all([
      authAPI.getPublicSettings(),
      keysAPI.list(1, 100, { status: 'active' }),
    ])
    const resolved = resolvePlaygroundApiEndpoint(
      settings.api_base_url || '',
      window.location.hostname,
    )
    if (!isCurrentRequest()) return
    const creatorKey = selectCanvasCreatorKey(keyResponse.items || [], localStorage, ownerID)
    if (!creatorKey) {
      throw new Error('请先在生图工作台选择一个可用的 API Key')
    }
    const baseURL = import.meta.env.DEV
      ? '/v1'
      : new URL(resolved, window.location.origin).toString().replace(/\/+$/, '')
    bootstrapPayload.value = {
      baseUrl: baseURL,
      apiKey: creatorKey.key,
      accessToken: authStore.token || '',
      channelName: canvasChannelName(creatorKey),
      locale: canvasLocale.value,
    }
  } catch (cause) {
    if (!isCurrentRequest()) return
    error.value = cause instanceof Error ? cause.message : '无法准备画布密钥'
  } finally {
    if (isCurrentRequest()) loading.value = false
  }
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

function handleFrameMessage(event: MessageEvent<{ type?: string }>) {
  if (event.source !== frameRef.value?.contentWindow) return
  if (event.data?.type !== 'create-canvas-ready') return
  if (frameReadyFallbackTimer) window.clearTimeout(frameReadyFallbackTimer)
  frameReady.value = true
}

onMounted(() => {
  window.addEventListener('message', handleFrameMessage)
  void Promise.all([resolveFrameURL(), loadContext()])
})
onUnmounted(() => {
  window.removeEventListener('message', handleFrameMessage)
  if (frameReadyFallbackTimer) window.clearTimeout(frameReadyFallbackTimer)
  clearBootstrapTimers()
})
watch(isDark, postTheme)
watch(canvasLocale, postLocale)
watch(bootstrapPayload, sendBootstrap)
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
