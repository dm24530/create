<template>
  <AppLayout>
    <div class="video-studio">
      <header class="video-studio__header">
        <div class="video-studio__title">
          <h1>AI 视频工作台</h1>
          <p>写清镜头与动作，或带上参考素材，生成一段短视频。</p>
        </div>

        <div class="video-studio__toolbar">
          <label class="toolbar-field">
            <span>API Key</span>
            <ImageStudioSelect
              v-model="selectedKeyId"
              class="toolbar-field__select"
              data-testid="api-key-select"
              :options="apiKeyOptions"
              :placeholder="apiKeyOptions.length ? '选择密钥' : '没有可用密钥'"
              direction="down"
            />
          </label>
          <label class="toolbar-field">
            <span>模型</span>
            <ImageStudioSelect
              v-model="videoModel"
              class="toolbar-field__select toolbar-field__select--model"
              data-testid="video-model-select"
              :options="videoModelOptions"
              :disabled="loadingModels || videoModels.length === 0"
              :placeholder="modelSelectPlaceholder"
              direction="down"
            />
          </label>
          <button
            type="button"
            class="mini-action"
            data-testid="video-refresh"
            title="刷新密钥和模型"
            :disabled="refreshing"
            @click="refreshAll"
          >
            <Icon name="refresh" size="sm" :class="{ 'is-spinning': refreshing }" />
          </button>
          <RouterLink class="toolbar-link" to="/video-inspiration">
            <Icon name="lightbulb" size="sm" />
            <span>灵感库</span>
          </RouterLink>
          <RouterLink class="toolbar-link" to="/video-works">
            <Icon name="grid" size="sm" />
            <span>我的作品</span>
            <em v-if="works.length">{{ works.length }}</em>
          </RouterLink>
          <span v-if="modelLoadError" class="toolbar-error">{{ modelLoadError }}</span>
        </div>
      </header>

      <section class="video-studio__stage" data-testid="video-stage">
        <div v-if="!tasks.length" class="video-studio__empty">
          <div class="video-studio__empty-icon">
            <Icon name="play" size="xl" />
          </div>
          <p class="video-studio__empty-title">写一个镜头，开始生成视频</p>
          <p class="video-studio__empty-hint">支持文字生成视频，也可以带上一张参考图延续画面。</p>
        </div>

        <div v-else class="video-grid">
          <article v-for="task in tasks" :key="task.localId" class="video-card">
            <div class="video-card__media">
              <video
                v-if="task.videoUrl"
                :src="task.videoUrl"
                class="video-card__video"
                controls
                playsinline
                preload="metadata"
              />
              <div v-else-if="task.status === 'failed'" class="video-card__state video-card__state--error">
                <Icon name="exclamationCircle" size="lg" />
                <strong>生成失败</strong>
                <small>{{ task.error || '请稍后重试' }}</small>
              </div>
              <div v-else class="video-card__state">
                <span class="video-card__spinner" aria-hidden="true"></span>
                <strong>{{ task.stageText }}</strong>
                <small>{{ task.requestId ? `任务 ${task.requestId}` : '正在提交任务' }}</small>
              </div>
            </div>
            <div class="video-card__body">
              <p class="video-card__prompt" :title="task.prompt">{{ task.prompt || '未填写提示词' }}</p>
              <p class="video-card__meta">{{ taskMeta(task) }}</p>
            </div>
            <div class="video-card__actions">
              <button
                v-if="task.videoUrl"
                type="button"
                class="mini-action"
                title="下载视频"
                @click="downloadTask(task)"
              >
                <Icon name="download" size="sm" />
              </button>
              <button
                v-if="task.status === 'succeeded'"
                type="button"
                class="mini-action"
                title="查看详情"
                @click="previewTask = task"
              >
                <Icon name="eye" size="sm" />
              </button>
              <button
                v-if="task.status === 'queued' || task.status === 'running'"
                type="button"
                class="mini-action"
                title="刷新任务状态"
                @click="refreshTask(task)"
              >
                <Icon name="sync" size="sm" />
              </button>
              <button type="button" class="mini-action" title="删除记录" @click="discardTask(task)">
                <Icon name="trash" size="sm" />
              </button>
            </div>
          </article>
        </div>
      </section>

      <form class="video-composer" @submit.prevent="generate">
        <div
          v-if="errorMessage"
          class="video-composer__alert video-composer__alert--error"
        >
          {{ errorMessage }}
        </div>
        <div v-if="inspirationHint" class="video-composer__alert" data-testid="inspiration-hint">
          <span>{{ inspirationHint }}</span>
          <button type="button" class="video-composer__alert-close" @click="inspirationHint = ''">
            <Icon name="x" size="xs" />
          </button>
        </div>

        <div v-if="references.length" class="reference-row">
          <div v-for="asset in references" :key="asset.id" class="reference-chip">
            <img
              v-if="asset.kind === 'image'"
              :src="asset.url"
              :alt="asset.name"
              class="reference-chip__thumb"
            />
            <span v-else class="reference-chip__glyph">
              <Icon :name="asset.kind === 'video' ? 'play' : 'bell'" size="xs" />
            </span>
            <span class="reference-chip__text">
              <strong>{{ kindLabel(asset) }}</strong>
              <small>{{ asset.name }}</small>
            </span>
            <button type="button" class="reference-chip__remove" @click="removeReference(asset.id)">
              <Icon name="x" size="xs" />
            </button>
          </div>
        </div>

        <textarea
          v-model="prompt"
          rows="3"
          class="video-composer__prompt"
          placeholder="描述画面、动作与运镜，例如：镜头缓慢推进，海雾从左侧涌入，光线逐渐转暖..."
          @paste="onPaste"
        />

        <div class="video-composer__controls">
          <button
            type="button"
            class="control-button"
            data-testid="video-reference-trigger"
            @click="openReferenceDialog"
          >
            <Icon name="paperclip" size="sm" />
            <span>参考素材</span>
            <em v-if="references.length">{{ references.length }}</em>
          </button>

          <div class="control-field control-field--duration">
            <span class="control-field__label">时长</span>
            <div class="count-stepper" data-testid="video-duration-control">
              <button
                type="button"
                class="count-stepper__button"
                data-testid="duration-decrement"
                aria-label="减少时长"
                :disabled="durationSeconds <= MIN_DURATION"
                @click="adjustDuration(-1)"
              >
                <Icon name="minus" size="xs" />
              </button>
              <input
                v-model.number="durationSeconds"
                type="number"
                :min="MIN_DURATION"
                :max="MAX_DURATION"
                aria-label="视频时长（秒）"
                @blur="normalizeDuration"
              />
              <button
                type="button"
                class="count-stepper__button"
                data-testid="duration-increment"
                aria-label="增加时长"
                :disabled="durationSeconds >= MAX_DURATION"
                @click="adjustDuration(1)"
              >
                <Icon name="plus" size="xs" />
              </button>
              <span class="count-stepper__suffix">秒</span>
            </div>
          </div>

          <label class="control-field">
            <span class="control-field__label">画幅</span>
            <ImageStudioSelect
              v-model="aspectRatio"
              data-testid="video-ratio-select"
              :options="aspectRatioOptions"
            />
          </label>

          <label class="control-field">
            <span class="control-field__label">画质</span>
            <ImageStudioSelect
              v-model="resolution"
              data-testid="video-resolution-select"
              :options="resolutionOptions"
            />
          </label>

          <button
            type="button"
            class="control-toggle"
            :class="{ 'control-toggle--on': generateAudio }"
            data-testid="video-audio-toggle"
            :aria-pressed="generateAudio"
            @click="generateAudio = !generateAudio"
          >
            <Icon name="bell" size="sm" />
            <span>生成音频</span>
          </button>

          <div class="video-composer__spacer" />
          <button type="submit" class="primary-button" data-testid="video-generate" :disabled="!canGenerate">
            <Icon name="sparkles" size="sm" />
            {{ generating ? '生成中' : '生成视频' }}
          </button>
        </div>
      </form>
    </div>

    <BaseDialog
      :show="referenceDialogOpen"
      title="添加参考素材"
      width="normal"
      @close="closeReferenceDialog"
    >
      <div class="reference-dialog">
        <div class="segmented" role="tablist" aria-label="参考素材类型">
          <button
            v-for="option in referenceKindOptions"
            :key="option.value"
            type="button"
            role="tab"
            class="segmented__item"
            :class="{ 'segmented__item--active': referenceKind === option.value }"
            :aria-selected="referenceKind === option.value"
            :data-testid="`reference-kind-${option.value}`"
            @click="referenceKind = option.value"
          >
            <Icon :name="option.icon" size="sm" />
            <span>{{ option.label }}</span>
          </button>
        </div>

        <template v-if="referenceKind === 'image'">
          <div class="reference-dialog__field">
            <p class="reference-dialog__label">参考图作用</p>
            <div class="segmented segmented--compact">
              <button
                v-for="role in imageRoleOptions"
                :key="role.value"
                type="button"
                class="segmented__item"
                :class="{ 'segmented__item--active': referenceRole === role.value }"
                :data-testid="`reference-role-${role.value}`"
                @click="referenceRole = role.value"
              >
                {{ role.label }}
              </button>
            </div>
            <p class="reference-dialog__hint">{{ imageRoleHint }}</p>
          </div>

          <input
            ref="referenceFileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="onReferenceFileSelected"
          />
          <button type="button" class="secondary-button" @click="referenceFileInput?.click()">
            <Icon name="upload" size="sm" />
            <span>选择本地图片</span>
          </button>
        </template>

        <p class="reference-dialog__label">
          {{ referenceKind === 'image' ? '或粘贴图片链接' : referenceKind === 'video' ? '粘贴参考视频链接' : '粘贴参考音频链接' }}
        </p>
        <div class="reference-dialog__url">
          <input
            v-model="referenceUrlDraft"
            type="url"
            class="text-input"
            :placeholder="referenceUrlPlaceholder"
            data-testid="reference-url-input"
            @keydown.enter.prevent="confirmReferenceUrl"
          />
          <button type="button" class="primary-button" @click="confirmReferenceUrl">
            添加
          </button>
        </div>
        <p v-if="referenceDialogError" class="reference-dialog__error">{{ referenceDialogError }}</p>
        <p class="reference-dialog__hint">{{ referenceLimitHint }}</p>
      </div>
    </BaseDialog>

    <BaseDialog
      :show="!!previewTask"
      :title="previewTask?.model || '视频详情'"
      width="wide"
      @close="closePreview"
    >
      <div v-if="previewTask" class="preview">
        <video
          v-if="previewTask.videoUrl"
          :src="previewTask.videoUrl"
          class="preview__video"
          controls
          playsinline
        />
        <p class="preview__prompt">{{ previewTask.prompt || '未填写提示词' }}</p>
        <dl class="preview__meta">
          <div>
            <dt>时长</dt>
            <dd>{{ previewTask.durationSeconds }} 秒</dd>
          </div>
          <div>
            <dt>画幅</dt>
            <dd>{{ previewTask.aspectRatio }}</dd>
          </div>
          <div>
            <dt>画质</dt>
            <dd>{{ previewTask.resolution }}</dd>
          </div>
          <div>
            <dt>协议</dt>
            <dd>{{ previewTask.provider === 'grok' ? 'Grok 视频' : 'Seedance' }}</dd>
          </div>
        </dl>
      </div>
      <template #footer>
        <div class="preview__footer">
          <button
            type="button"
            class="secondary-button"
            :disabled="!previewTask?.prompt"
            @click="copyPreviewPrompt"
          >
            <Icon name="copy" size="sm" />
            <span>复制提示词</span>
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="!previewTask?.videoUrl"
            @click="previewTask && downloadTask(previewTask)"
          >
            <Icon name="download" size="sm" />
            <span>下载视频</span>
          </button>
        </div>
      </template>
    </BaseDialog>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { authAPI, keysAPI } from '@/api'
import type { ApiKey } from '@/types'
import { useClipboard } from '@/composables/useClipboard'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'

import ImageStudioSelect from '../image-studio/ImageStudioSelect.vue'
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  cancelVideoTask,
  createVideoTask,
  fetchVideoPlayableUrl,
  isVideoModel,
  pollVideoTask,
  resolveVideoProvider,
  type VideoProvider,
  type VideoReferenceAsset,
  type VideoTaskStatus,
} from './videoStudioApi'
import {
  createVideoWorkId,
  listVideoWorks,
  removeVideoWork,
  saveVideoWork,
  updateVideoWork,
  type VideoWorkRecord,
} from './videoWorks'
import { findVideoInspiration } from './videoInspiration'

interface StudioTask {
  localId: string
  provider: VideoProvider
  requestId: string
  keyId: number
  model: string
  prompt: string
  durationSeconds: number
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  referenceCounts: { images: number; videos: number; audios: number }
  status: VideoTaskStatus
  stageText: string
  videoUrl: string
  revokeUrl: boolean
  error: string
  createdAt: number
}

const MIN_DURATION = 1
const MAX_DURATION = 15
const MAX_IMAGES = 4
const MAX_VIDEOS = 1
const MAX_AUDIOS = 1

// 与灵感库共用：在线灵感把提示词放这里，跳回工作台时读取。
const PENDING_PROMPT_STORAGE_KEY = 'sub2api:video-studio:pending-prompt'

const route = useRoute()
const { copyToClipboard } = useClipboard()

const keys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const apiBaseUrl = ref('')
const videoModel = ref('')
const videoModels = ref<string[]>([])
const loadingModels = ref(false)
const refreshing = ref(false)
const modelLoadError = ref('')

const errorMessage = ref('')
const inspirationHint = ref('')
const prompt = ref('')
const durationSeconds = ref(5)
const resolution = ref('720p')
const aspectRatio = ref('16:9')
const generateAudio = ref(false)

const references = ref<VideoReferenceAsset[]>([])
const referenceDialogOpen = ref(false)
const referenceKind = ref<'image' | 'video' | 'audio'>('image')
const referenceRole = ref<'first_frame' | 'last_frame' | 'reference_image'>('first_frame')
const referenceUrlDraft = ref('')
const referenceDialogError = ref('')
const referenceFileInput = ref<HTMLInputElement | null>(null)

const tasks = ref<StudioTask[]>([])
const works = ref<VideoWorkRecord[]>([])
const previewTask = ref<StudioTask | null>(null)
const activeGenerations = ref(0)
const cancelledTasks = new Set<string>()

let nextReferenceId = 1
let modelRequestId = 0

const activeKeys = computed(() => keys.value.filter((key) => key.status === 'active'))
const apiKeyOptions = computed(() => activeKeys.value.map((key) => ({ value: String(key.id), label: key.name })))
const selectedKey = computed(() =>
  activeKeys.value.find((key) => String(key.id) === selectedKeyId.value) || null,
)
const videoModelOptions = computed(() => videoModels.value.map((model) => ({ value: model, label: model })))
const modelSelectPlaceholder = computed(() => {
  if (loadingModels.value) return '正在加载...'
  if (!videoModels.value.length) return '未找到视频模型'
  return '选择模型'
})
const canGenerate = computed(() =>
  Boolean(apiBaseUrl.value && selectedKey.value?.key && videoModel.value.trim() && prompt.value.trim()),
)
const generating = computed(() => activeGenerations.value > 0)

const aspectRatioOptions = VIDEO_ASPECT_RATIOS.map((item) => ({ value: item.value, label: item.label }))
const resolutionOptions = VIDEO_RESOLUTIONS.map((item) => ({ value: item, label: item }))

const referenceKindOptions = [
  { value: 'image' as const, label: '参考图', icon: 'grid' },
  { value: 'video' as const, label: '参考视频', icon: 'play' },
  { value: 'audio' as const, label: '参考音频', icon: 'bell' },
] as const
const imageRoleOptions = [
  { value: 'first_frame' as const, label: '首帧' },
  { value: 'last_frame' as const, label: '尾帧' },
  { value: 'reference_image' as const, label: '参考图' },
]
const imageRoleHint = computed(() => {
  switch (referenceRole.value) {
    case 'first_frame':
      return '以这张图作为视频的第一帧，画面从这里开始运动。'
    case 'last_frame':
      return '以这张图作为视频的最后一帧，画面向它收束。'
    default:
      return '作为风格或内容参考，不锁定具体帧位置。'
  }
})
const referenceUrlPlaceholder = computed(() => {
  if (referenceKind.value === 'image') return 'https://.../frame.png'
  if (referenceKind.value === 'video') return 'https://.../reference.mp4'
  return 'https://.../reference.mp3'
})
const referenceLimitHint = computed(() => {
  if (referenceKind.value === 'image') {
    return `参考图最多 ${MAX_IMAGES} 张，支持上传本地图片或粘贴图片链接。`
  }
  if (referenceKind.value === 'video') return `参考视频最多 ${MAX_VIDEOS} 个，请提供可公开访问的链接。`
  return `参考音频最多 ${MAX_AUDIOS} 个，请提供可公开访问的链接。`
})

function resolveEndpoint(configured: string) {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname
  return resolvePlaygroundApiEndpoint(configured, hostname)
}

function contextFor(key: ApiKey) {
  return { baseUrl: apiBaseUrl.value, apiKey: key.key }
}

function resolveSelectedKey(keyId: number): ApiKey | null {
  return activeKeys.value.find((key) => key.id === keyId) || null
}

function statusText(status: VideoTaskStatus): string {
  switch (status) {
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '生成失败'
    case 'running':
      return '生成中'
    default:
      return '排队中'
  }
}

function kindLabel(asset: VideoReferenceAsset): string {
  if (asset.kind === 'image') {
    if (asset.role === 'first_frame') return '首帧'
    if (asset.role === 'last_frame') return '尾帧'
    return '参考图'
  }
  return asset.kind === 'video' ? '参考视频' : '参考音频'
}

function taskMeta(task: StudioTask): string {
  return [
    task.model,
    `${task.durationSeconds}秒`,
    task.resolution,
    task.aspectRatio,
    task.generateAudio ? '含音频' : '',
  ].filter(Boolean).join(' · ')
}

async function loadData() {
  errorMessage.value = ''
  const keysPromise = keysAPI.list(1, 100, { status: 'active' })
    .then((response) => {
      keys.value = response.items || []
      if (!selectedKeyId.value || !activeKeys.value.some((key) => String(key.id) === selectedKeyId.value)) {
        selectedKeyId.value = activeKeys.value.length ? String(activeKeys.value[0].id) : ''
      }
    })
    .catch((error) => {
      errorMessage.value = errorMessageFrom(error, '加载密钥失败')
    })
  const settingsPromise = authAPI.getPublicSettings()
    .then((settings) => {
      apiBaseUrl.value = resolveEndpoint(settings.api_base_url || '')
    })
    .catch((error) => {
      if (!errorMessage.value) errorMessage.value = errorMessageFrom(error, '加载设置失败')
    })

  await Promise.allSettled([keysPromise, settingsPromise])
  applyInspirationFromRoute()
  resumeWorks()
}

// 灵感库「带入工作台」通过 query 传递模板标识，这里把参数写进编辑器。
function applyInspirationFromRoute() {
  // 在线灵感只有提示词（没有可套用的本地参数），走 sessionStorage 传，
  // 避免把长提示词塞进 URL。
  try {
    const pending = sessionStorage.getItem(PENDING_PROMPT_STORAGE_KEY)
    if (pending && pending.trim()) {
      prompt.value = pending.trim()
      inspirationHint.value = '已带入在线灵感提示词，选好参考素材就可以生成。'
      sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY)
      return
    }
  } catch {
    // 浏览器存储不可用时按没有待带入提示词处理。
  }
  const slug = String(route.query.inspiration || '')
  const template = findVideoInspiration(slug)
  if (!template) return
  prompt.value = template.prompt
  durationSeconds.value = template.durationSeconds
  resolution.value = template.resolution
  aspectRatio.value = template.aspectRatio
  generateAudio.value = template.requiresAudio

  const needs: string[] = []
  if (template.requiresImages > 0) needs.push(`${template.requiresImages} 张参考图`)
  if (template.requiresVideo) needs.push('1 个参考视频')
  if (template.requiresAudio) needs.push('1 个参考音频')
  inspirationHint.value = needs.length
    ? `已带入「${template.title}」，这个镜头还需要：${needs.join('、')}。`
    : `已带入「${template.title}」，参数与提示词都已填好，可以直接生成。`
}

function resumeWorks() {
  const records = listVideoWorks()
  works.value = records
  for (const record of records) {
    if (record.status === 'succeeded' || record.status === 'failed') continue
    const task = taskFromRecord(record)
    tasks.value.push(task)
    void runTask(task, null)
  }
}

function taskFromRecord(record: VideoWorkRecord): StudioTask {
  return {
    localId: record.id,
    provider: record.provider,
    requestId: record.requestId,
    keyId: record.keyId,
    model: record.model,
    prompt: record.prompt,
    durationSeconds: record.durationSeconds,
    resolution: record.resolution,
    aspectRatio: record.aspectRatio,
    generateAudio: record.generateAudio,
    referenceCounts: record.referenceCounts,
    status: record.status,
    stageText: statusText(record.status),
    videoUrl: record.videoUrl,
    revokeUrl: false,
    error: record.status === 'failed' ? record.statusMessage : '',
    createdAt: record.createdAt,
  }
}

function recordFromTask(task: StudioTask, status: VideoTaskStatus, statusMessage: string): VideoWorkRecord {
  return {
    id: task.localId,
    provider: task.provider,
    requestId: task.requestId,
    keyId: task.keyId,
    model: task.model,
    prompt: task.prompt,
    durationSeconds: task.durationSeconds,
    resolution: task.resolution,
    aspectRatio: task.aspectRatio,
    generateAudio: task.generateAudio,
    referenceCounts: task.referenceCounts,
    videoUrl: task.videoUrl,
    createdAt: task.createdAt,
    status,
    statusMessage,
  }
}

function persistTask(task: StudioTask, status: VideoTaskStatus, statusMessage: string) {
  updateVideoWork(task.localId, recordFromTask(task, status, statusMessage))
  works.value = listVideoWorks()
}

async function loadModels() {
  const requestId = ++modelRequestId
  loadingModels.value = true
  videoModels.value = []
  videoModel.value = ''
  modelLoadError.value = ''
  const key = selectedKey.value
  const endpoint = apiBaseUrl.value
  if (!key || !endpoint) {
    loadingModels.value = false
    return
  }

  try {
    const names = await fetchModelNames(`${endpoint}/models`, key.key)
    if (requestId !== modelRequestId) return
    videoModels.value = deduplicateModelNames(names.filter(isVideoModel))
    videoModel.value = videoModels.value[0] || ''
  } catch (error) {
    if (requestId === modelRequestId) modelLoadError.value = errorMessageFrom(error, '加载视频模型失败')
  } finally {
    if (requestId === modelRequestId) loadingModels.value = false
  }
}

async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  errorMessage.value = ''
  modelLoadError.value = ''
  const previousModel = videoModel.value
  try {
    await loadData()
    await nextTick()
    await loadModels()
    if (previousModel && videoModels.value.includes(previousModel)) videoModel.value = previousModel
  } finally {
    refreshing.value = false
  }
}

async function fetchModelNames(endpoint: string, apiKey: string): Promise<string[]> {
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `${response.status} ${response.statusText}`)
  }
  if (!Array.isArray(payload?.data)) return []
  return payload.data
    .map((item: any) => (typeof item === 'string' ? item : item?.id || item?.model || item?.name || ''))
    .map((name: unknown) => String(name).trim())
    .filter(Boolean)
}

function deduplicateModelNames(names: string[]): string[] {
  const unique = new Map<string, string>()
  for (const rawName of names) {
    const name = rawName.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!unique.has(key)) unique.set(key, name)
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

function errorMessageFrom(error: unknown, fallback = '操作失败'): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : ''
  const normalized = message.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'failed to fetch' || normalized.includes('network error')) {
    return '无法连接到 API 服务，请检查网络或 API 地址。'
  }
  if (normalized.includes('insufficient') || normalized.includes('余额不足')) {
    return '账户余额不足，请先充值或换一个有余额的 API Key。'
  }
  if (normalized.includes('temporarily unavailable')) {
    return '当前模型暂时不可用，请稍后重试或换一个模型。'
  }
  return message || fallback
}

/* ------------------------------- 参考素材 ------------------------------- */

function openReferenceDialog() {
  referenceDialogError.value = ''
  referenceUrlDraft.value = ''
  referenceDialogOpen.value = true
}

function closeReferenceDialog() {
  referenceDialogOpen.value = false
  referenceDialogError.value = ''
  referenceUrlDraft.value = ''
}

function referenceCount(kind: 'image' | 'video' | 'audio'): number {
  return references.value.filter((asset) => asset.kind === kind).length
}

function addReference(asset: Omit<VideoReferenceAsset, 'id'>): boolean {
  if (asset.kind === 'image' && referenceCount('image') >= MAX_IMAGES) {
    referenceDialogError.value = `参考图最多 ${MAX_IMAGES} 张。`
    return false
  }
  if (asset.kind === 'video' && referenceCount('video') >= MAX_VIDEOS) {
    referenceDialogError.value = `参考视频最多 ${MAX_VIDEOS} 个。`
    return false
  }
  if (asset.kind === 'audio' && referenceCount('audio') >= MAX_AUDIOS) {
    referenceDialogError.value = `参考音频最多 ${MAX_AUDIOS} 个。`
    return false
  }
  references.value.push({ ...asset, id: nextReferenceId++ })
  return true
}

function onReferenceFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    referenceDialogError.value = '只支持 PNG、JPEG、WEBP 图片。'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const added = addReference({
      kind: 'image',
      name: file.name || 'reference.png',
      url: String(reader.result || ''),
      role: referenceRole.value,
    })
    if (added) closeReferenceDialog()
  }
  reader.readAsDataURL(file)
}

function confirmReferenceUrl() {
  const url = referenceUrlDraft.value.trim()
  if (!url) {
    referenceDialogError.value = '请输入素材链接。'
    return
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith('data:')) {
    referenceDialogError.value = '链接需要以 http(s):// 开头。'
    return
  }
  const name = url.split('/').pop()?.split('?')[0] || 'reference'
  const added = addReference({
    kind: referenceKind.value,
    name,
    url,
    role: referenceKind.value === 'image' ? referenceRole.value : undefined,
  })
  if (added) closeReferenceDialog()
}

function onPaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith('image/'))
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    addReference({
      kind: 'image',
      name: file.name || 'pasted.png',
      url: String(reader.result || ''),
      role: referenceRole.value,
    })
  }
  reader.readAsDataURL(file)
}

function removeReference(id: number) {
  references.value = references.value.filter((asset) => asset.id !== id)
}

/* -------------------------------- 生成流程 -------------------------------- */

function adjustDuration(delta: number) {
  durationSeconds.value = clampDuration(Number(durationSeconds.value) + delta)
}

function normalizeDuration() {
  durationSeconds.value = clampDuration(Number(durationSeconds.value))
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.min(Math.max(Math.round(value), MIN_DURATION), MAX_DURATION)
}

async function generate() {
  const key = selectedKey.value
  if (!canGenerate.value || !key) return

  const localId = createVideoWorkId()
  const model = videoModel.value.trim()
  const provider = resolveVideoProvider(model)
  const task: StudioTask = {
    localId,
    provider,
    requestId: '',
    keyId: key.id,
    model,
    prompt: prompt.value.trim(),
    durationSeconds: clampDuration(durationSeconds.value),
    resolution: resolution.value,
    aspectRatio: aspectRatio.value,
    generateAudio: generateAudio.value,
    referenceCounts: {
      images: referenceCount('image'),
      videos: referenceCount('video'),
      audios: referenceCount('audio'),
    },
    status: 'queued',
    stageText: '正在提交任务',
    videoUrl: '',
    revokeUrl: false,
    error: '',
    createdAt: Date.now(),
  }
  tasks.value.unshift(task)
  saveVideoWork(recordFromTask(task, 'queued', '正在提交任务'))
  works.value = listVideoWorks()
  errorMessage.value = ''
  await runTask(task, {
    key,
    references: references.value.slice(),
  })
}

async function runTask(
  task: StudioTask,
  submission: { key: ApiKey; references: VideoReferenceAsset[] } | null,
) {
  const key = submission?.key || resolveSelectedKey(task.keyId)
  if (!key) {
    task.status = 'failed'
    task.stageText = '生成失败'
    task.error = '找不到发起任务时使用的 API Key，请重新生成。'
    persistTask(task, 'failed', task.error)
    return
  }
  if (!apiBaseUrl.value) {
    task.status = 'failed'
    task.stageText = '生成失败'
    task.error = 'API 端点不可用，请检查站点设置。'
    persistTask(task, 'failed', task.error)
    return
  }

  activeGenerations.value += 1
  const context = contextFor(key)
  try {
    if (!task.requestId) {
      const created = await createVideoTask(context, {
        model: task.model,
        prompt: task.prompt,
        durationSeconds: task.durationSeconds,
        resolution: task.resolution,
        aspectRatio: task.aspectRatio,
        generateAudio: task.generateAudio,
        images: (submission?.references || []).filter((asset) => asset.kind === 'image'),
        videos: (submission?.references || []).filter((asset) => asset.kind === 'video'),
        audios: (submission?.references || []).filter((asset) => asset.kind === 'audio'),
      })
      task.requestId = created.requestId
      task.provider = created.provider
      task.stageText = '排队中'
      persistTask(task, 'queued', '排队中')
    }

    const snapshot = await pollVideoTask(context, task.provider, task.requestId, {
      isCancelled: () => cancelledTasks.has(task.localId),
      onProgress: (progress) => {
        task.status = progress.status
        task.stageText = statusText(progress.status)
      },
    })

    if (cancelledTasks.has(task.localId)) {
      await cancelVideoTask(context, task.provider, task.requestId)
      return
    }

    if (snapshot.status === 'succeeded') {
      const playable = await fetchVideoPlayableUrl(context, task.provider, task.requestId, snapshot.videoUrl)
      task.videoUrl = playable.url
      task.revokeUrl = playable.revoke
      task.status = 'succeeded'
      task.stageText = '已完成'
      task.error = ''
      persistTask(task, 'succeeded', '')
      return
    }

    if (snapshot.status === 'failed') {
      task.status = 'failed'
      task.stageText = '生成失败'
      task.error = snapshot.errorMessage || `任务状态异常（${snapshot.rawStatus || 'failed'}）`
      persistTask(task, 'failed', task.error)
      return
    }

    // 轮询超时但任务仍在处理：保留记录，用户可以稍后刷新。
    task.stageText = '仍在处理中'
    persistTask(task, snapshot.status, '仍在处理中')
  } catch (error) {
    task.status = 'failed'
    task.stageText = '生成失败'
    task.error = errorMessageFrom(error, '生成失败')
    persistTask(task, 'failed', task.error)
  } finally {
    activeGenerations.value = Math.max(0, activeGenerations.value - 1)
  }
}

async function refreshTask(task: StudioTask) {
  if (!task.requestId || task.status === 'succeeded') return
  errorMessage.value = ''
  await runTask(task, null)
}

function discardTask(task: StudioTask) {
  cancelledTasks.add(task.localId)
  if (task.revokeUrl && task.videoUrl) URL.revokeObjectURL(task.videoUrl)
  tasks.value = tasks.value.filter((item) => item.localId !== task.localId)
  works.value = removeVideoWork(task.localId)
  if (previewTask.value?.localId === task.localId) previewTask.value = null
}

async function downloadTask(task: StudioTask) {
  if (!task.videoUrl) return
  const filename = `video-${task.createdAt}.mp4`
  try {
    const response = await fetch(task.videoUrl)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    window.open(task.videoUrl, '_blank')
  }
}

async function copyPreviewPrompt() {
  const text = previewTask.value?.prompt
  if (!text) return
  await copyToClipboard(text, '提示词已复制')
}

function closePreview() {
  previewTask.value = null
}

watch([selectedKeyId, apiBaseUrl], () => {
  void loadModels()
})

onMounted(loadData)

onBeforeUnmount(() => {
  for (const task of tasks.value) {
    if (task.revokeUrl && task.videoUrl) URL.revokeObjectURL(task.videoUrl)
  }
})
</script>

<style scoped>
.video-studio {
  display: flex;
  min-height: calc(100vh - 8rem);
  width: 100%;
  /* 与图片工作台保持同宽，否则两个工作台来回切换会有明显的宽度差。 */
  max-width: 120rem;
  margin: 0 auto;
  flex-direction: column;
  gap: 1rem;
}

.video-studio__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.video-studio__title h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: rgb(17 24 39);
}

.video-studio__title p {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: rgb(107 114 128);
}

.video-studio__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.toolbar-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.4rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.85);
  padding: 0 0.6rem;
  font-size: 0.8rem;
  color: rgb(107 114 128);
}

.toolbar-field__select {
  min-width: 9rem;
}

.toolbar-field__select--model {
  min-width: 13rem;
}

.toolbar-link {
  display: inline-flex;
  height: 2.4rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.85);
  padding: 0 0.7rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
  text-decoration: none;
}

.toolbar-link:hover {
  border-color: rgb(45 212 191);
  color: rgb(15 118 110);
}

.toolbar-link em {
  border-radius: 9999px;
  background: rgb(204 251 241);
  padding: 0 0.35rem;
  font-style: normal;
  font-size: 0.7rem;
  color: rgb(15 118 110);
}

.is-spinning {
  animation: video-spin 0.9s linear infinite;
}

.toolbar-error {
  font-size: 0.78rem;
  color: rgb(220 38 38);
}

.video-studio__stage {
  flex: 1;
  min-height: 22rem;
  overflow: auto;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  padding: 1rem;
}

.video-studio__empty {
  display: flex;
  min-height: 20rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: rgb(107 114 128);
}

.video-studio__empty-icon {
  display: flex;
  height: 4rem;
  width: 4rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(226 232 240);
  border-radius: 1rem;
  background: rgb(249 250 251);
}

.video-studio__empty-title {
  margin-top: 1rem;
  font-weight: 500;
  color: rgb(55 65 81);
}

.video-studio__empty-hint {
  margin-top: 0.25rem;
  font-size: 0.875rem;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1rem;
}

.video-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(249 250 251);
}

.video-card__media {
  position: relative;
  display: flex;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  background: rgb(17 24 39);
  overflow: hidden;
}

.video-card__video {
  height: 100%;
  width: 100%;
  object-fit: contain;
  background: rgb(0 0 0);
}

.video-card__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1rem;
  text-align: center;
  color: rgb(226 232 240);
}

.video-card__state small {
  max-width: 20rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  color: rgb(148 163 184);
}

.video-card__state--error {
  color: rgb(254 202 202);
}

.video-card__spinner {
  height: 1.6rem;
  width: 1.6rem;
  border-radius: 9999px;
  border: 2px solid rgb(148 163 184 / 0.35);
  border-top-color: rgb(45 212 191);
  animation: video-spin 0.9s linear infinite;
}

@keyframes video-spin {
  to {
    transform: rotate(360deg);
  }
}

.video-card__body {
  min-width: 0;
  padding: 0.6rem 0.75rem;
}

.video-card__prompt {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.85rem;
  font-weight: 500;
  color: rgb(31 41 55);
}

.video-card__meta {
  margin-top: 0.15rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  color: rgb(148 163 184);
}

.video-card__actions {
  display: flex;
  gap: 0.25rem;
  padding: 0 0.6rem 0.6rem;
}

.video-composer {
  position: sticky;
  bottom: 0.75rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 1rem;
  background: rgb(255 255 255);
  padding: 1rem;
  box-shadow: 0 20px 25px -5px rgb(15 23 42 / 0.15);
}

.video-composer__alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  border: 1px solid rgb(191 219 254);
  border-radius: 0.5rem;
  background: rgb(239 246 255);
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: rgb(30 64 175);
}

.video-composer__alert--error {
  border-color: rgb(254 202 202);
  background: rgb(254 242 242);
  color: rgb(185 28 28);
}

.video-composer__alert-close {
  flex-shrink: 0;
  color: inherit;
  opacity: 0.7;
}

.reference-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.reference-chip {
  display: flex;
  max-width: 13rem;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(249 250 251);
  padding: 0.25rem 0.4rem;
}

.reference-chip__thumb {
  height: 2rem;
  width: 2rem;
  border-radius: 0.25rem;
  object-fit: cover;
}

.reference-chip__glyph {
  display: flex;
  height: 2rem;
  width: 2rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  background: rgb(226 232 240);
  color: rgb(71 85 105);
}

.reference-chip__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.reference-chip__text strong {
  font-size: 0.72rem;
  color: rgb(51 65 85);
}

.reference-chip__text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  color: rgb(148 163 184);
}

.reference-chip__remove {
  flex-shrink: 0;
  color: rgb(148 163 184);
}

.reference-chip__remove:hover {
  color: rgb(239 68 68);
}

.video-composer__prompt {
  width: 100%;
  resize: none;
  border: 0;
  background: transparent;
  font-size: 0.875rem;
  color: rgb(17 24 39);
  outline: none;
}

.video-composer__prompt::placeholder {
  color: rgb(156 163 175);
}

.video-composer__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-top: 0.75rem;
  border-top: 1px solid rgb(243 244 246);
  padding-top: 0.75rem;
}

.video-composer__spacer {
  flex: 1;
}

.control-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.control-field__label {
  font-size: 0.7rem;
  color: rgb(107 114 128);
}

.control-button,
.control-toggle {
  display: inline-flex;
  height: 2.35rem;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  padding: 0 0.75rem;
  font-size: 0.82rem;
  color: rgb(51 65 85);
}

.control-button:hover,
.control-toggle:hover {
  border-color: rgb(45 212 191);
}

.control-button em {
  border-radius: 9999px;
  background: rgb(204 251 241);
  padding: 0 0.35rem;
  font-style: normal;
  font-size: 0.7rem;
  color: rgb(15 118 110);
}

.control-toggle--on {
  border-color: rgb(45 212 191);
  background: rgb(240 253 250);
  color: rgb(15 118 110);
}

.mini-action {
  display: inline-flex;
  height: 2.1rem;
  width: 2.1rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255);
  color: rgb(71 85 105);
}

.mini-action:hover {
  border-color: rgb(45 212 191);
  color: rgb(15 118 110);
}

.mini-action:disabled {
  opacity: 0.5;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  height: 2.35rem;
  align-items: center;
  gap: 0.4rem;
  border-radius: 0.75rem;
  padding: 0 0.9rem;
  font-size: 0.82rem;
}

.primary-button {
  background: rgb(13 148 136);
  color: rgb(255 255 255);
}

.primary-button:hover {
  background: rgb(15 118 110);
}

.primary-button:disabled {
  opacity: 0.5;
}

.secondary-button {
  border: 1px solid rgb(226 232 240);
  background: rgb(255 255 255);
  color: rgb(51 65 85);
}

.count-stepper {
  display: inline-flex;
  height: 2.35rem;
  align-items: center;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  padding: 0 0.25rem;
}

.count-stepper input {
  width: 2.6rem;
  border: 0;
  background: transparent;
  text-align: center;
  font-size: 0.85rem;
  color: rgb(30 41 59);
  outline: none;
  -moz-appearance: textfield;
}

.count-stepper input::-webkit-outer-spin-button,
.count-stepper input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.count-stepper__button {
  display: inline-flex;
  height: 1.8rem;
  width: 1.8rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  color: rgb(71 85 105);
}

.count-stepper__button:hover {
  background: rgb(240 253 250);
  color: rgb(15 118 110);
}

.count-stepper__button:disabled {
  opacity: 0.4;
}

.count-stepper__suffix {
  padding: 0 0.5rem 0 0.1rem;
  font-size: 0.72rem;
  color: rgb(148 163 184);
}

.reference-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.reference-dialog__label {
  font-size: 0.78rem;
  color: rgb(107 114 128);
}

.reference-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.reference-dialog__hint {
  font-size: 0.72rem;
  color: rgb(148 163 184);
}

.reference-dialog__error {
  font-size: 0.78rem;
  color: rgb(220 38 38);
}

.reference-dialog__url {
  display: flex;
  gap: 0.5rem;
}

.text-input {
  flex: 1;
  min-width: 0;
  height: 2.35rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255);
  padding: 0 0.6rem;
  font-size: 0.82rem;
  color: rgb(30 41 59);
  outline: none;
}

.text-input:focus {
  border-color: rgb(45 212 191);
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  border-radius: 0.75rem;
  background: rgb(241 245 249);
  padding: 0.25rem;
}

.segmented__item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 0.5rem;
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
}

.segmented__item--active {
  background: rgb(255 255 255);
  color: rgb(15 118 110);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
}

.segmented--compact .segmented__item {
  padding: 0.3rem 0.6rem;
  font-size: 0.76rem;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.preview__video {
  width: 100%;
  max-height: 60vh;
  border-radius: 0.5rem;
  background: rgb(0 0 0);
}

.preview__prompt {
  font-size: 0.85rem;
  color: rgb(51 65 85);
  white-space: pre-wrap;
}

.preview__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.preview__meta dt {
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.preview__meta dd {
  font-size: 0.82rem;
  color: rgb(30 41 59);
}

.preview__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.hidden {
  display: none;
}

@media (min-width: 640px) {
  .video-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .video-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

:global(.dark .video-studio__title h1) {
  color: rgb(255 255 255);
}

:global(.dark .toolbar-field),
:global(.dark .toolbar-link),
:global(.dark .video-composer),
:global(.dark .control-button),
:global(.dark .control-toggle),
:global(.dark .mini-action),
:global(.dark .secondary-button),
:global(.dark .count-stepper),
:global(.dark .text-input) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
  color: rgb(226 232 240);
}

:global(.dark .video-studio__stage) {
  border-color: rgb(51 65 85);
  background: rgb(15 23 42);
}

:global(.dark .video-card) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
}

:global(.dark .video-card__prompt) {
  color: rgb(241 245 249);
}

:global(.dark .video-composer__prompt) {
  color: rgb(241 245 249);
}

:global(.dark .preview__prompt) {
  color: rgb(226 232 240);
}

:global(.dark .reference-chip) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
}
</style>
