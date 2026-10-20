<template>
  <AppLayout>
    <div class="works">
      <header class="works__header">
        <div>
          <h1>我的作品</h1>
          <p>这里保存生成的图片和视频作品，已保存的内容换设备也能看到。</p>
          <p v-if="studioQuota" class="works__quota" data-testid="works-quota">
            存储额度：{{ studioQuota.used }} / {{ studioQuota.limit }}（图片与视频共用）
          </p>
        </div>
        <div class="works__toolbar">
          <label class="toolbar-field">
            <span>API Key</span>
            <ImageStudioSelect
              v-model="selectedKeyId"
              class="toolbar-field__select"
              data-testid="works-api-key-select"
              :options="apiKeyOptions"
              :placeholder="apiKeyOptions.length ? '选择密钥' : '没有可用密钥'"
              direction="down"
            />
          </label>
          <button
            type="button"
            class="mini-action"
            title="刷新密钥"
            :disabled="refreshing"
            @click="refreshKeys"
          >
            <Icon name="refresh" size="sm" :class="{ 'is-spinning': refreshing }" />
          </button>
          <RouterLink class="toolbar-link" to="/video-studio">
            <Icon name="play" size="sm" />
            <span>去工作台</span>
          </RouterLink>
          <button
            v-if="records.length"
            type="button"
            class="toolbar-link toolbar-link--danger"
            data-testid="works-clear"
            @click="clearAll"
          >
            <Icon name="trash" size="sm" />
            <span>清空</span>
          </button>
        </div>
      </header>

      <div
        v-if="errorMessage"
        class="works__alert"
        data-testid="works-error"
      >
        {{ errorMessage }}
      </div>

      <section class="works__stage">
        <template v-if="images.length">
          <div class="works__section-head">
            <h2>图片作品</h2>
            <span>图片工作台生成并保存到作品库的内容</span>
          </div>
          <div class="works-grid works-grid--archived">
            <article
              v-for="entry in images"
              :key="entry.id"
              class="work-card"
              :data-testid="`image-work-${entry.id}`"
            >
              <div class="work-card__media work-card__media--image">
                <img
                  :src="entry.url"
                  :alt="entry.prompt || '图片作品'"
                  class="work-card__image"
                  loading="lazy"
                />
              </div>
              <div class="work-card__body">
                <p class="work-card__prompt" :title="entry.prompt">{{ entry.prompt || '未填写提示词' }}</p>
                <p class="work-card__meta">{{ imageMeta(entry) }}</p>
                <p class="work-card__time">{{ formatTime(entry.created_at * 1000) }}</p>
                <p v-if="entry.saved" class="work-card__state work-card__state--saved">
                  已保存到我的作品
                </p>
                <p v-else class="work-card__state work-card__state--temp">
                  临时内容 · 还剩 {{ remainingDays(entry) }} 天
                </p>
              </div>
              <div class="work-card__actions">
                <button
                  v-if="!entry.saved"
                  type="button"
                  class="mini-action"
                  data-testid="image-work-pin"
                  title="存到我的作品（长期保留）"
                  @click="pinImageWork(entry)"
                >
                  <Icon name="bookmark" size="sm" />
                </button>
                <button type="button" class="mini-action" title="下载图片" @click="downloadImageWork(entry)">
                  <Icon name="download" size="sm" />
                </button>
                <button
                  type="button"
                  class="mini-action"
                  title="复制提示词"
                  :disabled="!entry.prompt"
                  @click="copyPromptText(entry.prompt)"
                >
                  <Icon name="copy" size="sm" />
                </button>
                <button type="button" class="mini-action" title="删除图片作品" @click="removeImageWork(entry)">
                  <Icon name="trash" size="sm" />
                </button>
              </div>
            </article>
          </div>
        </template>

        <!-- 已归档：文件在对象存储、记录在后端，换浏览器/清缓存都还在。 -->
        <template v-if="archived.length">
          <div class="works__section-head">
            <h2>已归档</h2>
            <span>存在对象存储里，换设备也能看到</span>
          </div>
          <div class="works-grid works-grid--archived">
            <article v-for="entry in archived" :key="entry.id" class="work-card" :data-testid="`archived-${entry.id}`">
              <div class="work-card__media">
                <video v-if="entry.url" :src="entry.url" class="work-card__video" controls playsinline preload="metadata" />
                <div v-else class="work-card__placeholder"><Icon name="play" size="lg" /><strong>已归档</strong></div>
              </div>
              <div class="work-card__body">
                <p class="work-card__prompt" :title="entry.prompt">{{ entry.prompt || '未填写提示词' }}</p>
                <p class="work-card__meta">{{ archivedMeta(entry) }}</p>
                <p class="work-card__time">{{ formatTime(entry.created_at * 1000) }}</p>
                <p v-if="entry.saved" class="work-card__state work-card__state--saved" data-testid="archived-saved-badge">
                  已保存到我的作品
                </p>
                <p v-else class="work-card__state work-card__state--temp" data-testid="archived-temp-badge">
                  临时内容 · 还剩 {{ remainingDays(entry) }} 天
                </p>
              </div>
              <div class="work-card__actions">
                <button
                  v-if="!entry.saved"
                  type="button"
                  class="mini-action"
                  data-testid="archived-pin"
                  title="存到我的作品（长期保留）"
                  @click="pinArchived(entry)"
                >
                  <Icon name="bookmark" size="sm" />
                </button>
                <button type="button" class="mini-action" title="下载视频" @click="downloadArchived(entry)">
                  <Icon name="download" size="sm" />
                </button>
                <button
                  type="button"
                  class="mini-action"
                  title="复制提示词"
                  :disabled="!entry.prompt"
                  @click="copyPromptText(entry.prompt)"
                >
                  <Icon name="copy" size="sm" />
                </button>
                <button type="button" class="mini-action" title="删除归档" @click="removeArchived(entry)">
                  <Icon name="trash" size="sm" />
                </button>
              </div>
            </article>
          </div>
        </template>

        <div v-if="!records.length && !archived.length && !images.length" class="works__empty">
          <div class="works__empty-icon">
            <Icon name="grid" size="xl" />
          </div>
          <p class="works__empty-title">还没有作品</p>
          <p class="works__empty-hint">生成并保存第一张图片或第一段视频后，会出现在这里。</p>
          <RouterLink class="primary-button" to="/video-studio">
            <Icon name="sparkles" size="sm" />
            <span>开始生成</span>
          </RouterLink>
        </div>

        <template v-if="records.length">
          <div v-if="archived.length" class="works__section-head">
            <h2>本机记录</h2>
            <span>只存在这个浏览器里，可用来重试或重新载入</span>
          </div>
          <div class="works-grid">
          <article
            v-for="record in records"
            :key="record.id"
            class="work-card"
            :data-testid="`work-${record.id}`"
          >
            <div class="work-card__media">
              <video
                v-if="playable[record.id]"
                :src="playable[record.id]"
                class="work-card__video"
                controls
                playsinline
                preload="metadata"
              />
              <div v-else class="work-card__placeholder">
                <Icon :name="record.status === 'failed' ? 'exclamationCircle' : 'play'" size="lg" />
                <strong>{{ statusLabel(record) }}</strong>
                <small>{{ record.statusMessage || record.requestId || '—' }}</small>
              </div>
            </div>

            <div class="work-card__body">
              <p class="work-card__prompt" :title="record.prompt">{{ record.prompt || '未填写提示词' }}</p>
              <p class="work-card__meta">{{ workMeta(record) }}</p>
              <p class="work-card__time">{{ formatTime(record.createdAt) }}</p>
            </div>

            <div class="work-card__actions">
              <button
                v-if="!playable[record.id]"
                type="button"
                class="mini-action"
                title="载入视频"
                @click="loadVideo(record)"
              >
                <Icon name="download" size="sm" />
              </button>
              <button
                v-if="record.status === 'queued' || record.status === 'running'"
                type="button"
                class="mini-action"
                title="刷新任务状态"
                @click="refreshRecord(record)"
              >
                <Icon name="sync" size="sm" />
              </button>
              <button
                v-if="playable[record.id]"
                type="button"
                class="mini-action"
                title="下载视频"
                @click="downloadRecord(record)"
              >
                <Icon name="download" size="sm" />
              </button>
              <button
                type="button"
                class="mini-action"
                title="复制提示词"
                :disabled="!record.prompt"
                @click="copyPrompt(record)"
              >
                <Icon name="copy" size="sm" />
              </button>
              <button type="button" class="mini-action" title="删除记录" @click="removeRecord(record)">
                <Icon name="trash" size="sm" />
              </button>
            </div>
          </article>
          </div>
        </template>
      </section>
    </div>

    <BaseDialog
      :show="!!activeRecord"
      :title="activeRecord?.model || '作品详情'"
      width="wide"
      :close-on-click-outside="true"
      @close="activeRecord = null"
    >
      <div v-if="activeRecord" class="work-detail">
        <video
          v-if="playable[activeRecord.id]"
          :src="playable[activeRecord.id]"
          class="work-detail__video"
          controls
          playsinline
        />
        <p class="work-detail__prompt">{{ activeRecord.prompt || '未填写提示词' }}</p>
        <dl class="work-detail__meta">
          <div>
            <dt>时长</dt>
            <dd>{{ activeRecord.durationSeconds }} 秒</dd>
          </div>
          <div>
            <dt>画幅</dt>
            <dd>{{ activeRecord.aspectRatio }}</dd>
          </div>
          <div>
            <dt>画质</dt>
            <dd>{{ activeRecord.resolution }}</dd>
          </div>
          <div>
            <dt>任务</dt>
            <dd>{{ activeRecord.requestId || '—' }}</dd>
          </div>
        </dl>
      </div>
      <template #footer>
        <div class="work-detail__footer">
          <button type="button" class="secondary-button" @click="activeRecord && copyPrompt(activeRecord)">
            <Icon name="copy" size="sm" />
            <span>复制提示词</span>
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="!activeRecord || !playable[activeRecord.id]"
            @click="activeRecord && downloadRecord(activeRecord)"
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import {
  authAPI,
  imageStudioGalleryAPI,
  keysAPI,
  type ImageStudioGalleryEntry,
} from '@/api'
import type { ApiKey } from '@/types'
import { useClipboard } from '@/composables/useClipboard'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'

import ImageStudioSelect from '../image-studio/ImageStudioSelect.vue'
import {
  fetchVideoPlayableUrl,
  fetchVideoTask,
  type VideoTaskStatus,
} from './videoStudioApi'
import {
  deleteArchivedVideo,
  fetchStudioWorksQuota,
  isStudioQuotaError,
  listArchivedVideos,
  pinArchivedVideo,
  type ArchivedVideoEntry,
} from './videoArchiveApi'
import {
  clearVideoWorks,
  listVideoWorks,
  removeVideoWork,
  updateVideoWork,
  type VideoWorkRecord,
} from './videoWorks'

const { copyToClipboard } = useClipboard()

const keys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const apiBaseUrl = ref('')
const records = ref<VideoWorkRecord[]>([])
const archived = ref<ArchivedVideoEntry[]>([])
const images = ref<ImageStudioGalleryEntry[]>([])
const studioQuota = ref<{ used: number; limit: number } | null>(null)
const playable = ref<Record<string, string>>({})
const activeRecord = ref<VideoWorkRecord | null>(null)
const errorMessage = ref('')
const refreshing = ref(false)

const activeKeys = computed(() => keys.value.filter((key) => key.status === 'active'))
const apiKeyOptions = computed(() => activeKeys.value.map((key) => ({ value: String(key.id), label: key.name })))

function resolveEndpoint(configured: string) {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname
  return resolvePlaygroundApiEndpoint(configured, hostname)
}

function contextFor(key: ApiKey) {
  return { baseUrl: apiBaseUrl.value, apiKey: key.key }
}

function keyFor(record: VideoWorkRecord): ApiKey | null {
  return activeKeys.value.find((key) => key.id === record.keyId) || null
}

function statusLabel(record: VideoWorkRecord): string {
  switch (record.status) {
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

function workMeta(record: VideoWorkRecord): string {
  return [
    record.model,
    `${record.durationSeconds}秒`,
    record.resolution,
    record.aspectRatio,
    record.generateAudio ? '含音频' : '',
  ].filter(Boolean).join(' · ')
}

function formatTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function loadData() {
  errorMessage.value = ''
  await Promise.allSettled([loadArchivedVideos(), loadImages()])
  records.value = visibleLocalRecords()
  const keysPromise = keysAPI.list(1, 100, { status: 'active' })
    .then((response) => {
      keys.value = response.items || []
      if (!selectedKeyId.value && activeKeys.value.length) {
        selectedKeyId.value = String(
          (records.value.length ? keyFor(records.value[0]) : null)?.id ?? activeKeys.value[0].id,
        )
      }
    })
    .catch(() => undefined)
  const settingsPromise = authAPI.getPublicSettings()
    .then((settings) => {
      apiBaseUrl.value = resolveEndpoint(settings.api_base_url || '')
    })
    .catch(() => undefined)

  await Promise.allSettled([keysPromise, settingsPromise])
  await restoreAvailableVideos()
}

async function loadImages() {
  try {
    images.value = await imageStudioGalleryAPI.list()
  } catch {
    images.value = []
  }
}

// 已归档的记录会同时留下一条本机记录，这里把重复的本地条目过滤掉，
// 免得同一段视频既显示在「已归档」又显示在「本机记录」。
function visibleLocalRecords(): VideoWorkRecord[] {
  const archivedUrls = new Set(archived.value.map((entry) => entry.url))
  return listVideoWorks().filter((record) => !record.archivedUrl || !archivedUrls.has(record.archivedUrl))
}

async function loadArchivedVideos() {
  try {
    archived.value = await listArchivedVideos()
  } catch {
    // 归档接口不可用（例如对象存储没配）时不影响本机记录展示。
    archived.value = []
  }
  await loadStudioQuota()
}

// 配额是图片 + 视频合起来算的，这里只做展示，满了后端会在归档时拒绝。
async function loadStudioQuota() {
  try {
    studioQuota.value = await fetchStudioWorksQuota()
  } catch {
    studioQuota.value = null
  }
}

function archivedMeta(entry: ArchivedVideoEntry): string {
  return [entry.model || '未知模型', entry.duration_seconds ? `${entry.duration_seconds}秒` : '']
    .filter(Boolean)
    .join(' · ')
}

function imageMeta(entry: ImageStudioGalleryEntry): string {
  return [entry.format?.toUpperCase(), entry.size, entry.model]
    .filter(Boolean)
    .join(' · ')
}

async function pinImageWork(entry: ImageStudioGalleryEntry) {
  errorMessage.value = ''
  try {
    await imageStudioGalleryAPI.pin(entry.id)
    entry.saved = true
    entry.expires_at = 0
    await loadStudioQuota()
  } catch (error) {
    errorMessage.value = isStudioQuotaError(error)
      ? `我的作品已满（${studioQuota.value?.limit || 100} 个），先删除一些再保存。`
      : error instanceof Error ? error.message : '保存到我的作品失败'
  }
}

function downloadImageWork(entry: ImageStudioGalleryEntry) {
  const link = document.createElement('a')
  link.href = entry.url
  link.download = `image-${entry.created_at}.${entry.format || 'png'}`
  link.target = '_blank'
  link.rel = 'noopener'
  link.click()
}

async function removeImageWork(entry: ImageStudioGalleryEntry) {
  const confirmed = typeof window === 'undefined'
    || window.confirm('删除这张图片？对象存储里的文件会一起删除，无法恢复。')
  if (!confirmed) return
  errorMessage.value = ''
  try {
    await imageStudioGalleryAPI.delete(entry.id)
    images.value = images.value.filter((item) => item.id !== entry.id)
    await loadStudioQuota()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除图片失败'
  }
}

async function downloadArchived(entry: ArchivedVideoEntry) {
  await downloadUrl(entry.url, `video-${entry.created_at}.mp4`)
}

async function removeArchived(entry: ArchivedVideoEntry) {
  const confirmed = typeof window === 'undefined'
    || window.confirm('删除这段视频？对象存储里的文件会一起删除，无法恢复。')
  if (!confirmed) return
  try {
    await deleteArchivedVideo(entry.id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除归档失败'
    return
  }
  archived.value = archived.value.filter((item) => item.id !== entry.id)
  records.value = visibleLocalRecords()
  await loadStudioQuota()
}

// 临时内容的剩余天数：向上取整，最少显示 1 天。
function remainingDays(entry: { expires_at: number }): number {
  const expiresAt = Number(entry.expires_at || 0)
  if (!expiresAt) return 0
  return Math.max(1, Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000))
}

// 存进「我的作品」：转永久、开始占配额。
async function pinArchived(entry: ArchivedVideoEntry) {
  errorMessage.value = ''
  try {
    await pinArchivedVideo(entry.id)
    entry.saved = true
    entry.expires_at = 0
    await loadStudioQuota()
  } catch (error) {
    errorMessage.value = isStudioQuotaError(error)
      ? `我的作品已满（${studioQuota.value?.limit || 100} 个），先删除一些再保存。`
      : error instanceof Error ? error.message : '保存到我的作品失败'
  }
}

async function refreshKeys() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await loadData()
  } finally {
    refreshing.value = false
  }
}

// 能直连播放的记录（Seedance 的 video_url）进入页面就直接可用，避免多余请求。
async function restoreAvailableVideos() {
  for (const record of records.value) {
    if (record.status !== 'succeeded') continue
    if (record.provider === 'seedance' && record.videoUrl) {
      playable.value = { ...playable.value, [record.id]: record.videoUrl }
      continue
    }
    void loadVideo(record)
  }
}

async function loadVideo(record: VideoWorkRecord) {
  const key = keyFor(record)
  if (!key || !apiBaseUrl.value) {
    errorMessage.value = '找不到发起任务时使用的 API Key，无法载入视频。'
    return
  }
  if (!record.requestId) return
  errorMessage.value = ''
  try {
    const snapshot = await fetchVideoTask(contextFor(key), record.provider, record.requestId)
    if (snapshot.status !== 'succeeded') {
      updateRecord(record, snapshot.status, snapshot.errorMessage)
      return
    }
    const result = await fetchVideoPlayableUrl(
      contextFor(key),
      record.provider,
      record.requestId,
      snapshot.videoUrl,
    )
    playable.value = { ...playable.value, [record.id]: result.url }
    if (snapshot.videoUrl && snapshot.videoUrl !== record.videoUrl) {
      updateRecord(record, 'succeeded', '', snapshot.videoUrl)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '载入视频失败'
  }
}

async function refreshRecord(record: VideoWorkRecord) {
  await loadVideo(record)
}

function updateRecord(
  record: VideoWorkRecord,
  status: VideoTaskStatus,
  statusMessage: string,
  videoUrl?: string,
) {
  records.value = updateVideoWork(record.id, {
    status,
    statusMessage,
    ...(videoUrl ? { videoUrl } : {}),
  })
}

async function downloadRecord(record: VideoWorkRecord) {
  const url = playable.value[record.id]
  if (!url) return
  await downloadUrl(url, `video-${record.createdAt}.mp4`)
}

async function downloadUrl(url: string, filename: string) {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank')
  }
}

function removeRecord(record: VideoWorkRecord) {
  const url = playable.value[record.id]
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  const next = { ...playable.value }
  delete next[record.id]
  playable.value = next
  removeVideoWork(record.id)
  records.value = visibleLocalRecords()
  if (activeRecord.value?.id === record.id) activeRecord.value = null
}

function clearAll() {
  for (const url of Object.values(playable.value)) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  playable.value = {}
  clearVideoWorks()
  records.value = []
  void loadArchivedVideos()
  activeRecord.value = null
}

async function copyPrompt(record: VideoWorkRecord) {
  if (!record.prompt) return
  await copyPromptText(record.prompt)
}

async function copyPromptText(prompt: string) {
  if (!prompt) return
  await copyToClipboard(prompt, '提示词已复制')
}

onMounted(loadData)

onBeforeUnmount(() => {
  for (const url of Object.values(playable.value)) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
})
</script>

<style scoped>
.works {
  display: flex;
  width: 100%;
  /* 与图片工作台保持同宽。 */
  max-width: 120rem;
  margin: 0 auto;
  flex-direction: column;
  gap: 1rem;
}

.works__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.works__header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: rgb(17 24 39);
}

.works__header p {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: rgb(107 114 128);
}

.works__quota {
  color: rgb(148 163 184) !important;
  font-size: 0.75rem !important;
}

.work-card__state {
  margin-top: 0.15rem;
  font-size: 0.72rem;
}

.work-card__state--saved {
  color: rgb(5 150 105);
}

.work-card__state--temp {
  color: rgb(217 119 6);
}

.works__toolbar {
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
  border-color: rgb(232 121 78);
  color: rgb(173 74 41);
}

.toolbar-link--danger:hover {
  border-color: rgb(248 113 113);
  color: rgb(220 38 38);
}

.is-spinning {
  animation: works-spin 0.9s linear infinite;
}

@keyframes works-spin {
  to {
    transform: rotate(360deg);
  }
}

.works__alert {
  border: 1px solid rgb(254 202 202);
  border-radius: 0.5rem;
  background: rgb(254 242 242);
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: rgb(185 28 28);
}

.works__stage {
  min-height: 22rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  padding: 1rem;
}

.works__empty {
  display: flex;
  min-height: 20rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  color: rgb(107 114 128);
}

.works__empty-icon {
  display: flex;
  height: 4rem;
  width: 4rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(226 232 240);
  border-radius: 1rem;
  background: rgb(249 250 251);
}

.works__empty-title {
  margin-top: 0.5rem;
  font-weight: 500;
  color: rgb(55 65 81);
}

.works__empty-hint {
  font-size: 0.85rem;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1rem;
}

.works-grid--archived {
  margin-bottom: 1.25rem;
}

.works__section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.works__section-head h2 {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgb(17 24 39);
}

.works__section-head span {
  font-size: 0.75rem;
  color: rgb(148 163 184);
}

:global(.dark .works__section-head h2) {
  color: rgb(255 255 255);
}

.work-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(249 250 251);
}

.work-card__media {
  display: flex;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  background: rgb(17 24 39);
  overflow: hidden;
}

.work-card__video {
  height: 100%;
  width: 100%;
  object-fit: contain;
}

.work-card__media--image {
  aspect-ratio: 1 / 1;
}

.work-card__image {
  display: block;
  height: 100%;
  width: 100%;
  object-fit: cover;
}

.work-card__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  color: rgb(203 213 225);
}

.work-card__placeholder small {
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.work-card__body {
  flex: 1;
  padding: 0.6rem 0.75rem;
}

.work-card__prompt {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.85rem;
  font-weight: 500;
  color: rgb(31 41 55);
}

.work-card__meta {
  margin-top: 0.15rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  color: rgb(148 163 184);
}

.work-card__time {
  margin-top: 0.15rem;
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.work-card__actions {
  display: flex;
  gap: 0.25rem;
  padding: 0 0.6rem 0.6rem;
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
  border-color: rgb(232 121 78);
  color: rgb(173 74 41);
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
  text-decoration: none;
}

.primary-button {
  background: rgb(232 121 78);
  color: rgb(28 18 13);
}

.primary-button:hover {
  background: rgb(240 152 115);
}

.primary-button:disabled {
  opacity: 0.5;
}

.secondary-button {
  border: 1px solid rgb(226 232 240);
  background: rgb(255 255 255);
  color: rgb(51 65 85);
}

.work-detail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.work-detail__video {
  width: 100%;
  max-height: 60vh;
  border-radius: 0.5rem;
  background: rgb(0 0 0);
}

.work-detail__prompt {
  font-size: 0.85rem;
  color: rgb(51 65 85);
  white-space: pre-wrap;
}

.work-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.work-detail__meta dt {
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.work-detail__meta dd {
  font-size: 0.82rem;
  color: rgb(30 41 59);
}

.work-detail__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (min-width: 640px) {
  .works-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .works-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

:global(.dark .works__header h1) {
  color: rgb(242 237 229);
}

:global(.dark .toolbar-field),
:global(.dark .toolbar-link),
:global(.dark .mini-action),
:global(.dark .secondary-button) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(227 219 208);
}

:global(.dark .works__stage) {
  border-color: rgb(66 61 55);
  background: rgb(29 28 25);
}

:global(.dark .work-card) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
}

:global(.dark .work-card__prompt),
:global(.dark .work-detail__prompt) {
  color: rgb(242 237 229);
}

:global(.dark .works__empty-icon) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(167 159 148);
}

:global(.dark .work-card__media) {
  background: rgb(20 19 18);
}

:global(.dark .works__empty-title) {
  color: rgb(227 219 208);
}
</style>
