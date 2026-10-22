<template>
  <div class="canvas-host">
    <div v-if="loading" class="canvas-host__loading">
      <span class="canvas-host__spinner" />
      <p>正在加载无限画布...</p>
    </div>

    <div v-else-if="error" class="canvas-host__error">
      <h1>画布加载失败</h1>
      <p>{{ error }}</p>
      <button type="button" @click="loadContext">重试</button>
    </div>

    <iframe
      v-else
      ref="frameRef"
      :src="frameURL"
      class="canvas-host__frame"
      allow="clipboard-read; clipboard-write; fullscreen; downloads"
      @load="sendBootstrap"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { authAPI } from '@/api'
import { ensureCreatorKey } from '@/composables/useCreatorKey'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'

const loading = ref(true)
const error = ref('')
const frameRef = ref<HTMLIFrameElement | null>(null)
const bootstrapPayload = ref<{ baseUrl: string; apiKey: string } | null>(null)
const bootstrapTimers: number[] = []

const frameURL = computed(() => {
  const base = import.meta.env.DEV
    ? 'http://localhost:3001'
    : '/canvas-app'
  return `${base}/canvas`
})

async function loadContext() {
  loading.value = true
  error.value = ''
  bootstrapPayload.value = null
  try {
    const [settings, creator] = await Promise.all([
      authAPI.getPublicSettings(),
      ensureCreatorKey('image'),
    ])
    const resolved = resolvePlaygroundApiEndpoint(
      settings.api_base_url || '',
      window.location.hostname,
    )
    const baseURL = import.meta.env.DEV
      ? '/v1'
      : new URL(resolved, window.location.origin).toString().replace(/\/+$/, '')
    bootstrapPayload.value = {
      baseUrl: baseURL,
      apiKey: creator.key.key,
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法准备画布密钥'
  } finally {
    loading.value = false
  }
}

function sendBootstrap() {
  if (!bootstrapPayload.value || !frameRef.value?.contentWindow) return
  const targetOrigin = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin
  const payload = {
    type: 'create-canvas-bootstrap',
    ...bootstrapPayload.value,
    managed: true,
  }
  for (const timer of bootstrapTimers.splice(0)) window.clearTimeout(timer)
  for (const delay of [0, 250, 750, 1500, 3000]) {
    bootstrapTimers.push(window.setTimeout(() => {
      frameRef.value?.contentWindow?.postMessage(payload, targetOrigin)
    }, delay))
  }
}

onMounted(loadContext)
</script>

<style scoped>
.canvas-host {
  position: fixed;
  inset: 0;
  z-index: 30;
  overflow: hidden;
  background: #0c0f14;
}

.canvas-host__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0c0f14;
}

.canvas-host__loading,
.canvas-host__error {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #0c0f14;
  color: #cbd5e1;
  text-align: center;
}

.canvas-host__loading p,
.canvas-host__error p {
  max-width: 520px;
  color: #94a3b8;
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
  color: #f8fafc;
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
