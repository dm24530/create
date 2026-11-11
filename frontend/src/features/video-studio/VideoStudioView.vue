<template>
  <AppLayout>
    <div class="video-studio studio-page">
      <div class="studio-page__nav xl:hidden"><StudioNav /></div>
      <header class="video-studio__header studio-page__header">
        <div class="video-studio__title">
          <h1>视频创作台</h1>
        </div>

        <div class="video-studio__toolbar">
          <div class="segmented segmented--compact provider-switch !hidden" role="tablist" aria-label="生成渠道">
            <button
              type="button"
              role="tab"
              class="segmented__item"
              :class="{ 'segmented__item--active': providerMode === 'platform' }"
              :aria-selected="providerMode === 'platform'"
              data-testid="provider-platform"
              @click="setProviderMode('platform')"
            >
              本站渠道
            </button>
            <button
              type="button"
              role="tab"
              class="segmented__item"
              :class="{ 'segmented__item--active': providerMode === 'custom' }"
              :aria-selected="providerMode === 'custom'"
              data-testid="provider-custom"
              @click="setProviderMode('custom')"
            >
              自定义渠道
            </button>
          </div>

          <template v-if="providerMode === 'platform'">
            <label class="toolbar-field toolbar-field--select">
              <span>API Key</span>
              <ImageStudioSelect
                v-model="selectedKeyId"
                class="toolbar-field__select"
                data-testid="api-key-select"
                :options="apiKeyOptions"
                :placeholder="'选择密钥'"
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
          </template>

          <template v-else>
            <label class="toolbar-field">
              <span>接口地址</span>
              <input
                v-model="customBaseUrl"
                type="text"
                class="toolbar-input toolbar-input--url"
                placeholder="https://api.example.com/v1"
                data-testid="custom-base-url"
              />
            </label>
            <label class="toolbar-field">
              <span>密钥</span>
              <input
                v-model="customApiKey"
                type="password"
                class="toolbar-input"
                placeholder="sk-..."
                autocomplete="off"
                data-testid="custom-api-key"
              />
            </label>
            <button
              type="button"
              class="mini-action"
              data-testid="custom-models-load"
              title="用这个渠道的密钥读取可用模型"
              :disabled="customLoadingModels"
              @click="loadCustomModels"
            >
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': customLoadingModels }" />
            </button>
          </template>

          <RouterLink class="toolbar-link" to="/video-inspiration">
            <Icon name="lightbulb" size="sm" />
            <span>灵感库</span>
          </RouterLink>
          <RouterLink class="toolbar-link" to="/video-works">
            <Icon name="grid" size="sm" />
            <span>我的作品</span>
            <em v-if="works.length">{{ works.length }}</em>
          </RouterLink>
        </div>
      </header>

      <section class="video-studio__stage studio-page__results" data-testid="video-stage">
        <div class="studio-results__head">
          <div class="studio-results__title">
            <Icon name="play" size="sm" />
            <h2>全部结果</h2>
            <span>{{ tasks.length }}</span>
          </div>
          <div class="studio-results__actions">
            <span
              v-if="activeTaskCount > 0"
              class="video-generation-status"
              data-testid="video-active-generations"
              aria-live="polite"
            >
              <Icon name="refresh" size="xs" class="is-spinning" />
              <span>{{ activeTaskCount }} 个任务进行中</span>
            </span>
            <button
              type="button"
              class="studio-results__action"
              :disabled="loadingResults"
              @click="loadArchivedResults"
            >
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': loadingResults }" />
              <span>加载历史记录</span>
            </button>
            <RouterLink to="/video-works" class="studio-results__action">
              <Icon name="bookmark" size="sm" />
              <span>我的作品</span>
            </RouterLink>
          </div>
        </div>
        <div class="studio-results__body">
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
                data-testid="video-result-player"
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
                <strong>
                  {{ task.stageText }} · {{ formatVideoElapsedSeconds(taskElapsedSeconds(task)) }}
                </strong>
                <small>{{ task.requestId ? `任务 ${task.requestId}` : '正在提交任务' }}</small>
              </div>
            </div>
            <div class="video-card__body">
              <p class="video-card__prompt" :title="task.prompt">{{ task.prompt || '未填写提示词' }}</p>
              <p class="video-card__meta">{{ formatTaskTime(task.createdAt) }} · {{ taskMeta(task) }}</p>
              <p
                v-if="task.archivedId"
                class="video-card__archive-state"
                :class="task.archivedSaved ? 'video-card__archive-state--saved' : 'video-card__archive-state--temp'"
                data-testid="video-archive-state"
              >
                {{ archiveStateText(task) }}
              </p>
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
                v-if="task.archivedId && !task.archivedSaved"
                type="button"
                class="mini-action"
                title="保存到我的作品"
                data-testid="video-archive-pin"
                @click="saveArchivedTask(task)"
              >
                <Icon name="bookmark" size="sm" />
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
              <button
                type="button"
                class="mini-action video-card__delete"
                title="删除记录"
                @click="requestDiscardTask(task)"
              >
                <Icon name="trash" size="sm" />
              </button>
            </div>
          </article>
        </div>
        </div>
      </section>

      <form class="video-composer studio-page__composer" @submit.prevent="generate">
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
        <div v-if="archiveHint" class="video-composer__alert" data-testid="archive-hint">
          <span>{{ archiveHint }}</span>
          <button type="button" class="video-composer__alert-close" @click="archiveHint = ''">
            <Icon name="x" size="xs" />
          </button>
        </div>

        <section class="video-composer__prompt-shell">
          <textarea
            ref="promptTextareaRef"
            v-model="prompt"
            rows="6"
            class="video-composer__prompt"
            :style="{ height: promptHeight }"
            :maxlength="MAX_PROMPT_CHARS"
            placeholder="描述画面、动作与运镜，例如：镜头缓慢推进，海雾从左侧涌入，光线逐渐转暖..."
            @paste="onPaste"
          />
          <div class="video-composer__prompt-footer">
            <ImageStudioSelect
              v-if="providerMode === 'platform'"
              v-model="videoModel"
              class="video-composer__model"
              data-testid="video-model-select"
              :options="videoModelOptions"
              :disabled="loadingModels || videoModels.length === 0"
              :placeholder="modelSelectPlaceholder"
              direction="down"
            />
            <input
              v-else
              v-model="customModel"
              class="video-composer__model-input"
              type="text"
              placeholder="模型名"
              list="video-custom-models"
              data-testid="custom-model"
            />
            <datalist id="video-custom-models">
              <option v-for="model in customModels" :key="model" :value="model" />
            </datalist>
            <div class="video-composer__prompt-actions">
              <button type="button" title="复制提示词" aria-label="复制提示词" @click="copyComposerPrompt">
                <Icon name="copy" size="sm" />
              </button>
              <button type="button" title="从剪贴板粘贴" aria-label="从剪贴板粘贴" @click="pasteComposerPrompt">
                <Icon name="clipboard" size="sm" />
              </button>
              <button type="button" title="清空提示词" aria-label="清空提示词" @click="prompt = ''">
                <Icon name="trash" size="sm" />
              </button>
              <button type="button" title="添加参考素材" aria-label="添加参考素材" @click="openReferenceDialog">
                <Icon name="paperclip" size="sm" />
              </button>
            </div>
          </div>
          <div class="video-composer__prompt-meta">
            <span>{{ prompt.length }}/{{ MAX_PROMPT_CHARS }}</span>
          </div>
          <div class="prompt-resize-row">
            <button
              type="button"
              class="prompt-resize-handle"
              aria-label="调整提示词框高度"
              title="拖拽调整提示词框高度"
              @pointerdown="startPromptResize"
            />
          </div>
        </section>

        <section
          class="video-composer__references"
          @dragover.prevent
          @drop.prevent="onDropReferences"
        >
          <div class="video-composer__section-head">
            <span>参考素材</span>
            <button type="button" title="添加参考素材" aria-label="添加参考素材" @click="openReferenceDialog">
              <Icon name="upload" size="sm" />
            </button>
          </div>
          <div class="video-composer__reference-grid">
            <div v-for="asset in references" :key="asset.id" class="video-composer__reference">
              <img
                v-if="asset.kind === 'image'"
                :src="asset.url"
                :alt="asset.name"
              />
              <span v-else class="video-composer__reference-glyph">
                <Icon :name="asset.kind === 'video' ? 'play' : 'bell'" size="sm" />
                <small>{{ kindLabel(asset) }}</small>
              </span>
              <button
                type="button"
                :aria-label="`移除 ${asset.name}`"
                @click="removeReference(asset.id)"
              >
                <Icon name="x" size="xs" />
              </button>
            </div>
            <button
              type="button"
              class="video-composer__upload-tile"
              data-testid="video-reference-trigger"
              title="添加参考素材"
              aria-label="添加参考素材"
              @click="openReferenceDialog"
            >
              <Icon name="plus" size="md" />
            </button>
          </div>
          <p class="video-composer__helper">
            可拖拽或粘贴参考图，也可添加参考视频和音频。参考图最多 {{ maxImages }} 张。
          </p>
        </section>

        <div class="video-composer__field">
          <span class="video-composer__field-label">清晰度</span>
          <div
            class="video-composer__segmented"
            :style="{ '--video-segment-count': resolutionOptions.length }"
            data-testid="video-resolution-control"
            role="group"
            aria-label="清晰度"
          >
            <button
              v-for="option in resolutionOptions"
              :key="option.value"
              type="button"
              :class="{ 'is-active': resolution === option.value }"
              @click="resolution = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="video-composer__field">
          <span class="video-composer__field-label">尺寸</span>
          <ImageStudioSelect
            v-model="aspectRatio"
            class="video-composer__size-picker"
            data-testid="video-size-select"
            :options="aspectRatioOptions"
            direction="up"
          />
        </div>

        <div class="video-composer__field">
          <span class="video-composer__field-label">秒数</span>
          <div class="video-composer__duration" data-testid="video-duration-control">
            <div
              class="video-composer__segmented"
              :style="{ '--video-segment-count': durationPresetOptions.length }"
              role="group"
              aria-label="时长"
            >
              <button
                v-for="duration in durationPresetOptions"
                :key="duration"
                type="button"
                :class="{ 'is-active': durationSeconds === duration }"
                @click="durationSeconds = duration"
              >
                {{ duration }}秒
              </button>
            </div>
            <label class="video-composer__duration-custom">
              <input
                v-model.number="durationSeconds"
                type="number"
                :min="MIN_DURATION"
                :max="MAX_DURATION"
                aria-label="视频时长（秒）"
                @blur="normalizeDuration"
              />
              <span>秒</span>
            </label>
          </div>
        </div>

        <div class="video-composer__field">
          <label class="video-composer__inline-field" for="video-task-count">
            <span class="video-composer__field-label">任务数量</span>
            <input
              id="video-task-count"
              v-model.number="taskCount"
              data-testid="video-task-count"
              type="number"
              :min="1"
              :max="MAX_TASK_COUNT"
              aria-label="任务数量"
              @blur="normalizeTaskCount"
            />
          </label>
          <div class="video-composer__audio-row">
            <span>生成音频</span>
            <div :class="{ 'pointer-events-none opacity-45': !supportsGenerateAudioToggle }">
              <Toggle v-model="generateAudio" />
            </div>
          </div>
          <p v-if="!supportsGenerateAudioToggle" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            当前视频协议不支持单独的音频开关。
          </p>
        </div>

        <div class="video-composer__footer">
          <button type="submit" class="video-composer__generate" data-testid="video-generate" :disabled="!canGenerate">
            <Icon name="sparkles" size="sm" />
            {{ generating ? '生成中' : '开始生成' }}
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
            @click="selectReferenceKind(option.value)"
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
        </template>
        <template v-else-if="referenceKind === 'video' && videoRoleOptions.length">
          <div class="reference-dialog__field">
            <p class="reference-dialog__label">参考视频用途</p>
            <div class="segmented segmented--compact">
              <button
                v-for="role in videoRoleOptions"
                :key="role.value"
                type="button"
                class="segmented__item"
                :class="{ 'segmented__item--active': videoReferenceRole === role.value }"
                :data-testid="`video-reference-role-${role.value}`"
                @click="videoReferenceRole = role.value"
              >
                {{ role.label }}
              </button>
            </div>
            <p class="reference-dialog__hint">{{ videoRoleHint }}</p>
          </div>
        </template>

        <input
          ref="referenceFileInput"
          type="file"
          :accept="referenceFileAccept"
          class="hidden"
          @change="onReferenceFileSelected"
        />
        <button
          type="button"
          class="secondary-button"
          data-testid="reference-file-trigger"
          @click="referenceFileInput?.click()"
        >
          <Icon name="upload" size="sm" />
          <span>{{ referenceFileLabel }}</span>
        </button>

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
        <p class="reference-dialog__hint">参考素材均可选，合计不超过 {{ MAX_REFERENCE_TOTAL_MB }}MB。</p>
      </div>
    </BaseDialog>

    <BaseDialog
      :show="!!previewTask"
      :title="previewTask?.model || '视频详情'"
      width="wide"
      :close-on-click-outside="true"
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
            <dd>{{ videoProviderLabel(previewTask.provider) }}</dd>
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

    <BaseDialog
      :show="!!deleteTaskCandidate"
      title="删除视频"
      :close-on-click-outside="false"
      @close="deleteTaskCandidate = null"
    >
      <div class="delete-task-confirm">
        <p>确定删除这条视频记录吗？</p>
        <p>删除后无法恢复；如果已归档，对象存储中的视频文件也会一起删除。</p>
      </div>
      <template #footer>
        <div class="delete-task-confirm__footer">
          <button type="button" class="secondary-button" @click="deleteTaskCandidate = null">取消</button>
          <button type="button" class="danger-button" data-testid="confirm-delete-task" @click="confirmDiscardTask">
            确认删除
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
import StudioNav from '@/components/layout/StudioNav.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Toggle from '@/components/common/Toggle.vue'
import Icon from '@/components/icons/Icon.vue'
import { authAPI } from '@/api'
import type { ApiKey } from '@/types'
import { useClipboard } from '@/composables/useClipboard'
import { usePromptResize } from '@/composables/usePromptResize'
import { ensureCreatorKey, isCreationServiceUnavailable } from '@/composables/useCreatorKey'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

import ImageStudioSelect from '../image-studio/ImageStudioSelect.vue'
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  cancelVideoTask,
  createVideoTask,
  fetchVideoPlayableUrl,
  getVideoModelProfile,
  isVideoModel,
  materializeVideoReferences,
  pollVideoTask,
  resolveVideoProvider,
  type VideoProvider,
  type VideoReferenceAsset,
  type VideoTaskStatus,
} from './videoStudioApi'
import {
  archiveVideo,
  deleteArchivedVideo,
  fetchStudioWorksQuota,
  isStudioQuotaError,
  listArchivedVideos,
  pinArchivedVideo,
  type ArchivedVideoEntry,
} from './videoArchiveApi'
import {
  createVideoWorkId,
  listVideoWorks,
  removeVideoWork,
  saveVideoWork,
  updateVideoWork,
  type VideoWorkRecord,
} from './videoWorks'
import { videoStudioDraft } from './videoStudioDraft'
import { findVideoInspiration } from './videoInspiration'
import { formatVideoElapsedSeconds } from './videoElapsed'
import { normalizeStudioDisplayOrder } from '@/features/studioDisplayOrder'
import { notifyCreatorKeyChanged } from '@/utils/creatorKeyEvents'
import { prepareImageReferenceImages } from '@/utils/imageReferenceCompression'

interface StudioTask {
  localId: string
  provider: VideoProvider
  requestId: string
  sourceId: string
  keyId: number
  // 发起任务时用的渠道（仅内存保存，不写进本地记录，避免密钥落盘）。
  baseUrl: string
  apiKeyRef: string
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
  displayOrder?: number
  expiresAt?: number
  archivedId?: string
  archivedSaved?: boolean
  archivedExpiresAt?: number
}

const MAX_TASK_COUNT = 4
// 参考素材限制对齐自家灵感站：单件体积 + 合计体积。
const MAX_IMAGE_BYTES = 1_000_000
const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_REFERENCE_TOTAL_BYTES = 30 * 1024 * 1024
const MAX_PROMPT_CHARS = 5000
const MAX_REFERENCE_TOTAL_MB = MAX_REFERENCE_TOTAL_BYTES / (1024 * 1024)

const ACCEPTED_TYPES: Record<'image' | 'video' | 'audio', string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg'],
}

// 与灵感库共用：在线灵感把提示词放这里，跳回工作台时读取。
const PENDING_PROMPT_STORAGE_KEY = 'sub2api:video-studio:pending-prompt'
// 自定义渠道的地址与模型名可以留在本地方便复用；密钥不落盘。
const PROVIDER_STORAGE_KEY = 'sub2api:video-studio:provider'
const PREFERENCES_STORAGE_KEY = 'sub2api:video-studio:preferences'

interface VideoStudioPreferences {
  keyId?: string
  providerMode?: 'platform' | 'custom'
  videoModel?: string
  customModel?: string
  resolution?: string
  aspectRatio?: string
  durationSeconds?: number
  taskCount?: number
  generateAudio?: boolean
}

function preferencesStorageKey(userId = authStore.user?.id) {
  return userId == null ? PREFERENCES_STORAGE_KEY : `${PREFERENCES_STORAGE_KEY}:${userId}`
}

function readVideoStudioPreferences(): VideoStudioPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(preferencesStorageKey()) || '{}')
    return parsed && typeof parsed === 'object' ? parsed as VideoStudioPreferences : {}
  } catch {
    return {}
  }
}

function writeVideoStudioPreferences(patch: VideoStudioPreferences) {
  try {
    localStorage.setItem(preferencesStorageKey(), JSON.stringify({
      ...readVideoStudioPreferences(),
      ...patch,
    }))
  } catch {
    // Persisting UI preferences is optional.
  }
}

function readPreferredKeyId(): string {
  const keyId = readVideoStudioPreferences().keyId
  return typeof keyId === 'string' ? keyId : ''
}

function writePreferredKeyId(keyId: string) {
  if (!keyId) return
  writeVideoStudioPreferences({ keyId })
}

const route = useRoute()
const appStore = useAppStore()
const authStore = useAuthStore()
const { copyToClipboard } = useClipboard()
const storedPreferences = readVideoStudioPreferences()

const keys = ref<ApiKey[]>([])
const selectedKeyId = ref(typeof storedPreferences.keyId === 'string' ? storedPreferences.keyId : '')
const apiBaseUrl = ref('')
// 生成渠道：默认走本站密钥；自定义渠道让用户直接填别家平台的地址与密钥。
const providerMode = ref<'platform' | 'custom'>(
  storedPreferences.providerMode === 'custom' ? 'custom' : 'platform',
)
const customBaseUrl = ref('')
const customApiKey = ref('')
const customModel = ref(typeof storedPreferences.customModel === 'string' ? storedPreferences.customModel : '')
const customModels = ref<string[]>([])
const customLoadingModels = ref(false)
const videoModel = ref(typeof storedPreferences.videoModel === 'string' ? storedPreferences.videoModel : '')
const videoModels = ref<string[]>([])
const loadingModels = ref(false)
const refreshing = ref(false)
const loadingResults = ref(false)
const generationClockNow = ref(Date.now())
let generationClockTimer: number | undefined

const errorMessage = ref('')
const inspirationHint = ref('')
const archiveHint = ref('')
const prompt = ref('')
const promptTextareaRef = ref<HTMLTextAreaElement | null>(null)
const { height: promptHeight, startResize: startPromptResize } = usePromptResize(promptTextareaRef, {
  storageKey: 'sub2api:video-studio:prompt-height',
})
const durationSeconds = ref(
  Number.isFinite(storedPreferences.durationSeconds)
    ? Math.min(60, Math.max(1, Math.round(Number(storedPreferences.durationSeconds))))
    : 5,
)
const taskCount = ref(
  Number.isFinite(storedPreferences.taskCount)
    ? Math.min(MAX_TASK_COUNT, Math.max(1, Math.round(Number(storedPreferences.taskCount))))
    : 1,
)
const resolution = ref(typeof storedPreferences.resolution === 'string' ? storedPreferences.resolution : '720p')
const aspectRatio = ref(typeof storedPreferences.aspectRatio === 'string' ? storedPreferences.aspectRatio : '16:9')
const generateAudio = ref(storedPreferences.generateAudio === true)

const references = ref<VideoReferenceAsset[]>([])
const referenceDialogOpen = ref(false)
const referenceKind = ref<'image' | 'video' | 'audio'>('image')
const referenceRole = ref<'first_frame' | 'last_frame' | 'reference_image'>('first_frame')
const videoReferenceRole = ref<'video_edit' | 'video_extension'>('video_edit')
const referenceUrlDraft = ref('')
const referenceDialogError = ref('')
const referenceFileInput = ref<HTMLInputElement | null>(null)

const draftOwnerId = String(authStore.user?.id || '')
if (videoStudioDraft.ownerId !== draftOwnerId) {
  videoStudioDraft.ownerId = draftOwnerId
  videoStudioDraft.initialized = false
  videoStudioDraft.prompt = ''
  videoStudioDraft.references = []
} else if (videoStudioDraft.initialized) {
  prompt.value = videoStudioDraft.prompt
  references.value = videoStudioDraft.references.map((item) => ({ ...item }))
}

const tasks = ref<StudioTask[]>([])
const works = ref<VideoWorkRecord[]>([])
const videoRetentionSeconds = ref(0)
const previewTask = ref<StudioTask | null>(null)
const deleteTaskCandidate = ref<StudioTask | null>(null)
const activeGenerations = ref(0)
const preparingReferences = ref(false)
const cancelledTasks = new Set<string>()
// 换成归档地址后退役的 blob URL：等离开页面再统一释放。
const retiredObjectURLs: string[] = []
let videoDisplayOrderCursor = Date.now() * 1000

function allocateVideoBatchDisplayOrder(count: number) {
  const batchSize = Math.max(1, count)
  videoDisplayOrderCursor = Math.max(
    Date.now() * 1000,
    videoDisplayOrderCursor + batchSize + 1,
  )
  return videoDisplayOrderCursor
}

function videoTaskOrder(task: StudioTask): number {
  return normalizeStudioDisplayOrder(task.displayOrder)
    || normalizeStudioDisplayOrder(task.createdAt)
}

function sortVideoTasks(items: StudioTask[]): StudioTask[] {
  return items.sort((a, b) =>
    videoTaskOrder(b) - videoTaskOrder(a)
    || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    || a.localId.localeCompare(b.localId),
  )
}

let nextReferenceId = Math.max(1, ...references.value.map((item) => item.id + 1))
let modelRequestId = 0

const activeKeys = computed(() => keys.value.filter((key) => key.status === 'active'))
const videoCapableKeys = computed(() => activeKeys.value.filter((key) => {
  if (!key.group) return true
  if (key.group.video_capable) return true
  if (key.group.platform === 'composite') return true
  return (
    key.group.video_price_480p != null ||
    key.group.video_price_720p != null ||
    key.group.video_price_1080p != null
  )
}))
const apiKeyOptions = computed(() => videoCapableKeys.value.map((key) => ({ value: String(key.id), label: key.name })))
const selectedKey = computed(() =>
  videoCapableKeys.value.find((key) => String(key.id) === selectedKeyId.value) || null,
)
const videoModelOptions = computed(() => videoModels.value.map((model) => ({ value: model, label: model })))
// 自定义渠道：地址与密钥都由用户自己填，模型既可以手写也可以用「获取模型」拉一次。
const effectiveBaseUrl = computed(() =>
  providerMode.value === 'custom' ? normalizeBaseUrl(customBaseUrl.value) : apiBaseUrl.value,
)
const effectiveApiKey = computed(() =>
  providerMode.value === 'custom' ? customApiKey.value.trim() : (selectedKey.value?.key || ''),
)
const effectiveModel = computed(() =>
  providerMode.value === 'custom' ? customModel.value.trim() : videoModel.value.trim(),
)
const providerHint = computed(() => ({
  baseUrl: effectiveBaseUrl.value,
  platform: providerMode.value === 'platform' ? selectedKey.value?.group?.platform : '',
}))
const effectiveProvider = computed(() => resolveVideoProvider(effectiveModel.value, providerHint.value))
const videoModelProfile = computed(() => getVideoModelProfile(effectiveModel.value, effectiveProvider.value))
const MIN_DURATION = computed(() => videoModelProfile.value.minDuration)
const MAX_DURATION = computed(() => videoModelProfile.value.maxDuration)
const maxImages = computed(() => videoModelProfile.value.maxImages)
const maxVideos = computed(() => videoModelProfile.value.maxVideos)
const maxAudios = computed(() =>
  (effectiveProvider.value === 'seedance' || effectiveProvider.value === 'seedance_video' || effectiveProvider.value === 'video_tasks') &&
    videoModelProfile.value.supportsAudio
    ? 1
    : 0,
)
const supportsGenerateAudioToggle = computed(() =>
  (effectiveProvider.value === 'seedance' || effectiveProvider.value === 'seedance_video') &&
    videoModelProfile.value.supportsAudio,
)
const durationPresetOptions = computed(() => {
  const allowed = videoModelProfile.value.durationOptions
  const defaultPresets = [5, 8, 10, 15, 30]
  const values = allowed?.length
    ? [1, 5, 8, 10, 20, 30].filter((value) => allowed.includes(value))
    : [...defaultPresets, ...(MAX_DURATION.value >= 60 ? [60] : [])]
      .filter((value) => value >= MIN_DURATION.value && value <= MAX_DURATION.value)
  if (!values.includes(videoModelProfile.value.defaultDuration)) {
    values.push(videoModelProfile.value.defaultDuration)
    values.sort((a, b) => a - b)
  }
  return values
})
const modelSelectPlaceholder = computed(() => {
  if (loadingModels.value) return '正在加载...'
  return '选择模型'
})
const canGenerate = computed(() =>
  Boolean(effectiveBaseUrl.value && effectiveApiKey.value && effectiveModel.value && prompt.value.trim()) &&
  !preparingReferences.value,
)
const generating = computed(() => activeGenerations.value > 0)
const activeTaskCount = computed(() =>
  tasks.value.filter((task) => task.status === 'queued' || task.status === 'running').length,
)

watch(
  activeTaskCount,
  (count) => {
    if (generationClockTimer) {
      window.clearInterval(generationClockTimer)
      generationClockTimer = undefined
    }
    generationClockNow.value = Date.now()
    if (count > 0) {
      generationClockTimer = window.setInterval(() => {
        generationClockNow.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true },
)

const aspectRatioOptions = computed(() =>
  VIDEO_ASPECT_RATIOS
    .filter((item) => videoModelProfile.value.aspectRatios.includes(item.value))
    .map((item) => ({
    value: item.value,
    label: videoSizeLabel(item.value, resolution.value),
    preview: item.css,
    })),
)
const resolutionOptions = computed(() =>
  VIDEO_RESOLUTIONS
    .filter((item) => videoModelProfile.value.resolutions.includes(item))
    .map((item) => ({ value: item, label: item.toUpperCase() })),
)

const allReferenceKindOptions = [
  { value: 'image' as const, label: '参考图', icon: 'grid' },
  { value: 'video' as const, label: '参考视频', icon: 'play' },
  { value: 'audio' as const, label: '参考音频', icon: 'bell' },
] as const
const referenceKindOptions = computed(() =>
  allReferenceKindOptions.filter((option) =>
    option.value !== 'video' || videoModelProfile.value.maxVideos > 0
  ).filter((option) =>
    option.value !== 'audio' || maxAudios.value > 0
  ),
)
const allImageRoleOptions = [
  { value: 'first_frame' as const, label: '首帧' },
  { value: 'last_frame' as const, label: '尾帧' },
  { value: 'reference_image' as const, label: '参考图' },
]
const imageRoleOptions = computed(() =>
  allImageRoleOptions.filter((option) => {
    if (option.value === 'first_frame') return videoModelProfile.value.modes.includes('image-to-video')
    if (option.value === 'last_frame') return videoModelProfile.value.modes.includes('first-last-frame')
    return videoModelProfile.value.modes.includes('reference-images')
  }),
)
const videoRoleOptions = computed(() =>
  [
    { value: 'video_edit' as const, label: '视频编辑' },
    { value: 'video_extension' as const, label: '视频延长' },
  ].filter((option) => {
    if (option.value === 'video_edit') return videoModelProfile.value.modes.includes('video-edit')
    return videoModelProfile.value.modes.includes('video-extension')
  }),
)
const videoRoleHint = computed(() =>
  videoReferenceRole.value === 'video_extension'
    ? '在参考视频结尾继续生成后续画面。'
    : '以参考视频为源视频进行编辑或改拍。',
)
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
const referenceFileAccept = computed(() => ACCEPTED_TYPES[referenceKind.value].join(','))
const referenceFileLabel = computed(() => {
  if (referenceKind.value === 'image') return '选择本地图片'
  return referenceKind.value === 'video' ? '选择本地视频' : '选择本地音频'
})
const referenceLimitHint = computed(() => {
  if (referenceKind.value === 'image') {
    return `参考图最多 ${maxImages.value} 张，本地图片会自动压缩，压缩后每张不超过 1MB。`
  }
  if (referenceKind.value === 'video') return `参考视频最多 ${maxVideos.value} 个，不超过 20MB，可上传本地视频或粘贴链接。`
  return `参考音频最多 ${maxAudios.value} 个，不超过 8MB，可上传本地音频或粘贴链接。`
})

function resolveEndpoint(configured: string) {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname
  return resolvePlaygroundApiEndpoint(configured, hostname)
}

// 用户填的地址可能带/不带尾部斜杠、也可能直接写到 /v1，统一归一化。
function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function showModelHint(message: string, type: 'warning' | 'error' = 'warning') {
  const text = message.trim()
  if (!text) return
  if (type === 'error') appStore.showError(text, 5000)
  else appStore.showWarning(text, 4000)
}

function setProviderMode(mode: 'platform' | 'custom') {
  if (providerMode.value === mode) return
  providerMode.value = mode
  errorMessage.value = ''
  persistProviderSettings()
}

function persistProviderSettings() {
  try {
    localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify({
      mode: providerMode.value,
      baseUrl: customBaseUrl.value.trim(),
      model: customModel.value.trim(),
    }))
  } catch {
    // 浏览器存储可选，写入失败不影响本次生成。
  }
}

function restoreProviderSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROVIDER_STORAGE_KEY) || 'null')
    if (!stored || typeof stored !== 'object') return
    if (stored.mode === 'platform' || stored.mode === 'custom') {
      providerMode.value = stored.mode
    }
    if (typeof stored.baseUrl === 'string') customBaseUrl.value = stored.baseUrl
    if (typeof stored.model === 'string') customModel.value = stored.model
  } catch {
    // 忽略损坏的本地记录。
  }
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

function kindName(kind: 'image' | 'video' | 'audio'): string {
  if (kind === 'image') return '参考图'
  return kind === 'video' ? '参考视频' : '参考音频'
}

function taskMeta(task: StudioTask): string {
  const profile = getVideoModelProfile(task.model, task.provider)
  return [
    task.model,
    task.durationSeconds ? `${task.durationSeconds}秒` : '',
    task.resolution,
    task.aspectRatio,
    task.generateAudio || profile.outputsAudio ? '含音频' : '',
  ].filter(Boolean).join(' · ')
}

function videoProviderLabel(provider: VideoProvider): string {
  if (provider === 'grok') return 'Grok 视频'
  if (provider === 'muse_video') return 'Muse 视频'
  if (provider === 'video_tasks') return 'MiniMax 视频'
  if (provider === 'seedance_video') return 'Seedance Video'
  return 'Seedance'
}

function archiveStateText(task: StudioTask): string {
  if (task.archivedSaved) return '已保存到我的作品'
  const expiresAt = Number(task.archivedExpiresAt || 0)
  if (!expiresAt) return '临时内容'
  const days = Math.max(1, Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000))
  return `临时内容 · 还剩 ${days} 天`
}

function taskElapsedSeconds(task: StudioTask): number {
  const startedAt = Number(task.createdAt || 0)
  if (!startedAt) return 0
  return Math.max(0, Math.floor((generationClockNow.value - startedAt) / 1000))
}

function formatTaskTime(timestamp: number): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function loadData() {
  errorMessage.value = ''
  const keysPromise = ensureCreatorKey('video')
    .then((result) => {
      keys.value = result.keys
      const preferredKey = videoCapableKeys.value.find(
        (key) => String(key.id) === readPreferredKeyId(),
      )
      const fallbackKey =
        videoCapableKeys.value.find((key) => key.id === result.key.id) ||
        videoCapableKeys.value[0] ||
        result.key
      selectedKeyId.value = String(preferredKey?.id ?? fallbackKey.id)
    })
    .catch((error) => {
      if (!isCreationServiceUnavailable(error)) {
        errorMessage.value = errorMessageFrom(error, '视频创作服务暂不可用')
      }
    })
  const settingsPromise = authAPI.getPublicSettings()
    .then((settings) => {
      apiBaseUrl.value = resolveEndpoint(settings.api_base_url || '')
    })
    .catch((error) => {
      if (!errorMessage.value) errorMessage.value = errorMessageFrom(error, '加载设置失败')
    })
  const quotaPromise = fetchStudioWorksQuota()
    .then((quota) => {
      videoRetentionSeconds.value = Math.max(0, Math.floor(Number(quota.retention_seconds) || 0))
    })
    .catch(() => {
      // 配额接口不可用不影响生成；失败历史会继续保留在本地。
    })

  await Promise.allSettled([keysPromise, settingsPromise, quotaPromise])
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
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiredIds: string[] = []
  videoDisplayOrderCursor = Math.max(
    videoDisplayOrderCursor,
    ...records.map((record) => Number(record.displayOrder) || 0),
  )
  for (const record of records) {
    if (record.status === 'failed') {
      const expiresAt = Number(record.expiresAt) > 0
        ? Number(record.expiresAt)
        : videoRetentionSeconds.value > 0
          ? Math.floor(record.createdAt / 1000) + videoRetentionSeconds.value
          : 0
      if (expiresAt > 0 && expiresAt <= nowSeconds) {
        expiredIds.push(record.id)
        continue
      }
      if (expiresAt > 0 && expiresAt !== record.expiresAt) {
        updateVideoWork(record.id, { expiresAt })
      }
      if (!tasks.value.some((task) => task.localId === record.id)) {
        tasks.value.push(taskFromRecord({ ...record, expiresAt: expiresAt || undefined }))
      }
      continue
    }
    if (
      record.status === 'succeeded' &&
      (record.archivedUrl || (record.videoUrl && !record.videoUrl.startsWith('blob:')))
    ) continue
    // 这个会话里已经挂着的任务不要再挂一次，否则会重复弹卡片、重复轮询。
    if (tasks.value.some((task) => task.localId === record.id)) continue
    const task = taskFromRecord(record)
    tasks.value.push(task)
    // 取回响应式代理再驱动：直接改原始对象不会触发重渲染。
    void runTask(tasks.value[tasks.value.length - 1], null)
  }
  for (const id of expiredIds) removeVideoWork(id)
  sortVideoTasks(tasks.value)
  works.value = listVideoWorks()
}

function taskFromRecord(record: VideoWorkRecord): StudioTask {
  const sourceId = record.sourceId || archiveSourceID(
    record.provider,
    record.requestId,
    record.id,
  )
  return {
    localId: record.id,
    provider: record.provider,
    requestId: record.requestId,
    sourceId,
    keyId: record.keyId,
    // 恢复历史任务时按本站密钥重新解析渠道，自定义渠道的密钥不落盘。
    baseUrl: '',
    apiKeyRef: '',
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
    displayOrder: record.displayOrder,
    expiresAt: record.expiresAt,
    archivedId: record.archivedId,
    archivedSaved: record.archivedSaved,
    archivedExpiresAt: record.archivedExpiresAt,
  }
}

function taskArchiveSourceID(task: Pick<StudioTask, 'provider' | 'requestId' | 'localId'>): string {
  return archiveSourceID(task.provider, task.requestId, task.localId)
}

function archiveSourceID(provider: VideoProvider, requestId: string, fallbackId: string): string {
  return requestId.trim()
    ? `${provider}:${requestId.trim()}`
    : `local:${fallbackId}`
}

function archivedTaskLocalId(id: string): string {
  return `archive:${id}`
}

function taskFromArchived(entry: ArchivedVideoEntry): StudioTask {
  const model = entry.model || 'seedance'
  return {
    localId: archivedTaskLocalId(entry.id),
    provider: resolveVideoProvider(model),
    requestId: '',
    sourceId: entry.source_id || '',
    keyId: 0,
    baseUrl: '',
    apiKeyRef: '',
    model,
    prompt: entry.prompt || '',
    durationSeconds: Number(entry.duration_seconds || 0),
    resolution: '',
    aspectRatio: '',
    generateAudio: false,
    referenceCounts: { images: 0, videos: 0, audios: 0 },
    status: 'succeeded',
    stageText: '已完成',
    videoUrl: entry.url,
    revokeUrl: false,
    error: '',
    createdAt: Number(entry.created_at || 0) * 1000,
    displayOrder: Number(entry.sort_order || 0) || Number(entry.created_at || 0) * 1_000_000,
    expiresAt: 0,
    archivedId: entry.id,
    archivedSaved: entry.saved,
    archivedExpiresAt: entry.expires_at,
  }
}

function recordFromTask(task: StudioTask, status: VideoTaskStatus, statusMessage: string): VideoWorkRecord {
  return {
    id: task.localId,
    provider: task.provider,
    requestId: task.requestId,
    sourceId: task.sourceId || taskArchiveSourceID(task),
    keyId: task.keyId,
    model: task.model,
    prompt: task.prompt,
    durationSeconds: task.durationSeconds,
    resolution: task.resolution,
    aspectRatio: task.aspectRatio,
    generateAudio: task.generateAudio,
    referenceCounts: task.referenceCounts,
    videoUrl: task.videoUrl,
    archivedId: task.archivedId,
    archivedUrl: task.archivedId && task.videoUrl ? task.videoUrl : undefined,
    archivedSaved: task.archivedSaved,
    archivedExpiresAt: task.archivedExpiresAt,
    createdAt: task.createdAt,
    displayOrder: task.displayOrder,
    expiresAt: task.expiresAt,
    status,
    statusMessage,
  }
}

function persistTask(task: StudioTask, status: VideoTaskStatus, statusMessage: string) {
  const record = recordFromTask(task, status, statusMessage)
  if (status === 'failed') {
    if (!task.expiresAt && videoRetentionSeconds.value > 0) {
      task.expiresAt = Math.floor(Date.now() / 1000) + videoRetentionSeconds.value
      record.expiresAt = task.expiresAt
    }
  } else {
    task.expiresAt = undefined
    record.expiresAt = undefined
  }
  updateVideoWork(task.localId, record)
  works.value = listVideoWorks()
}

async function loadModels() {
  const requestId = ++modelRequestId
  loadingModels.value = true
  videoModels.value = []
  const preferredModel = videoModel.value || readVideoStudioPreferences().videoModel || ''
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
    videoModel.value = videoModels.value.includes(preferredModel)
      ? preferredModel
      : videoModels.value[0] || ''
  } catch (error) {
    if (requestId === modelRequestId) {
      showModelHint(errorMessageFrom(error, '加载视频模型失败'), 'error')
    }
  } finally {
    if (requestId === modelRequestId) loadingModels.value = false
  }
}

async function loadArchivedResults() {
  if (loadingResults.value) return
  loadingResults.value = true
  try {
    const entries = await listArchivedVideos('temp')
    const entriesBySource = new Map(
      entries
        .filter((entry) => entry.url && entry.source_id)
        .map((entry) => [entry.source_id!, entry] as const),
    )
    for (const task of tasks.value) {
      const entry = task.sourceId ? entriesBySource.get(task.sourceId) : undefined
      if (!entry) continue
      task.archivedId = entry.id
      task.archivedSaved = entry.saved
      task.archivedExpiresAt = entry.expires_at
      task.videoUrl = entry.url
      task.revokeUrl = false
      updateVideoWork(task.localId, {
        sourceId: task.sourceId,
        videoUrl: entry.url,
        archivedId: entry.id,
        archivedUrl: entry.url,
        archivedSaved: entry.saved,
        archivedExpiresAt: entry.expires_at,
      })
    }
    const existingArchivedIds = new Set(
      tasks.value
        .map((task) => task.archivedId)
        .filter((id): id is string => Boolean(id)),
    )
    const existingSourceIds = new Set(
      tasks.value
        .map((task) => task.sourceId)
        .filter(Boolean),
    )
    const imported = entries
      .filter((entry) =>
        entry.url &&
        !existingArchivedIds.has(entry.id) &&
        (!entry.source_id || !existingSourceIds.has(entry.source_id)),
      )
      .map(taskFromArchived)
    if (imported.length) {
      tasks.value = sortVideoTasks([...tasks.value, ...imported])
    }
  } catch {
    // 对象存储未启用时仍保留当前会话结果，不阻断生成。
  } finally {
    loadingResults.value = false
  }
}

// 自定义渠道：用用户自己的地址与密钥拉一次模型列表，拉不到也不阻断手写模型名。
async function loadCustomModels() {
  const baseUrl = normalizeBaseUrl(customBaseUrl.value)
  const apiKey = customApiKey.value.trim()
  if (!baseUrl || !apiKey) {
    showModelHint('请先填写接口地址和密钥。')
    return
  }
  customLoadingModels.value = true
  try {
    const names = deduplicateModelNames(await fetchModelNames(`${baseUrl}/models`, apiKey))
    const videoOnly = names.filter(isVideoModel)
    // 别家渠道的模型命名五花八门，过滤后为空就退回全部，让用户自己挑。
    customModels.value = videoOnly.length ? videoOnly : names
    if (!customModels.value.length) showModelHint('没有读到模型，可以直接手写模型名。')
    else if (!customModel.value.trim()) customModel.value = customModels.value[0]
    persistProviderSettings()
  } catch (error) {
    showModelHint(errorMessageFrom(error, '获取模型失败'), 'error')
  } finally {
    customLoadingModels.value = false
  }
}

async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  errorMessage.value = ''
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
  if (isCreationServiceUnavailable(error)) return ''
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

// 切换参考素材类型时清掉上一种类型留下的报错（比如"只支持 PNG 图片"）。
function selectReferenceKind(kind: 'image' | 'video' | 'audio') {
  referenceKind.value = kind
  referenceDialogError.value = ''
}

function referenceTotalBytes(): number {
  return references.value.reduce((total, asset) => total + (asset.sizeBytes || 0), 0)
}

function referenceSizeLimit(kind: 'image' | 'video' | 'audio'): number {
  if (kind === 'image') return MAX_IMAGE_BYTES
  return kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES
}

function referenceSizeLimitLabel(kind: 'image' | 'video' | 'audio'): string {
  return `${referenceSizeLimit(kind) / (1024 * 1024)}MB`
}

function addReference(asset: Omit<VideoReferenceAsset, 'id'>): boolean {
  if (asset.kind === 'image' && referenceCount('image') >= maxImages.value) {
    referenceDialogError.value = `参考图最多 ${maxImages.value} 张。`
    return false
  }
  if (asset.kind === 'video' && referenceCount('video') >= maxVideos.value) {
    referenceDialogError.value = `参考视频最多 ${maxVideos.value} 个。`
    return false
  }
  if (asset.kind === 'audio' && referenceCount('audio') >= maxAudios.value) {
    referenceDialogError.value = `参考音频最多 ${maxAudios.value} 个。`
    return false
  }
  if (asset.sizeBytes && asset.sizeBytes > referenceSizeLimit(asset.kind)) {
    referenceDialogError.value = `单个${kindName(asset.kind)}不能超过 ${referenceSizeLimitLabel(asset.kind)}。`
    return false
  }
  if (referenceTotalBytes() + (asset.sizeBytes || 0) > MAX_REFERENCE_TOTAL_BYTES) {
    referenceDialogError.value = `参考素材合计不能超过 ${MAX_REFERENCE_TOTAL_MB}MB。`
    return false
  }
  references.value.push({ ...asset, id: nextReferenceId++ })
  return true
}

async function onReferenceFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const kind = referenceKind.value
  if (!ACCEPTED_TYPES[kind].includes(file.type)) {
    referenceDialogError.value = `${kindName(kind)}的格式不支持，请换一个文件。`
    return
  }
  if (kind === 'image') {
    try {
      const asset = await prepareVideoReferenceImage(file, referenceRole.value)
      if (addReference(asset)) closeReferenceDialog()
    } catch (error) {
      referenceDialogError.value = errorMessageFrom(error, '参考图压缩失败')
    }
    return
  }
  if (file.size > referenceSizeLimit(kind)) {
    referenceDialogError.value = `单个文件不能超过 ${referenceSizeLimitLabel(kind)}。`
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const added = addReference({
      kind,
      name: file.name || 'reference',
      url: String(reader.result || ''),
      role: kind === 'video' ? videoReferenceRole.value : undefined,
      sizeBytes: file.size,
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
    role: referenceKind.value === 'image'
      ? referenceRole.value
      : referenceKind.value === 'video'
        ? videoReferenceRole.value
        : undefined,
  })
  if (added) closeReferenceDialog()
}

async function onPaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith('image/'))
  if (!file) return
  try {
    addReference(await prepareVideoReferenceImage(file, referenceRole.value))
  } catch (error) {
    errorMessage.value = errorMessageFrom(error, '参考图压缩失败')
  }
}

async function onDropReferences(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files || [])
    .filter((file) => ACCEPTED_TYPES.image.includes(file.type))
    .slice(0, Math.max(0, maxImages.value - referenceCount('image')))
  for (const file of files) {
    try {
      addReference(await prepareVideoReferenceImage(file, referenceRole.value))
    } catch (error) {
      errorMessage.value = errorMessageFrom(error, '参考图压缩失败')
    }
  }
}

async function prepareVideoReferenceImage(
  file: File,
  role: VideoReferenceAsset['role'],
): Promise<Omit<VideoReferenceAsset, 'id'>> {
  const [prepared] = await prepareImageReferenceImages([{ name: file.name, blob: file }])
  if (!prepared) throw new Error('参考图压缩失败')
  return {
    kind: 'image',
    name: compressedReferenceFileName(file.name),
    url: prepared.dataUrl,
    role,
    sizeBytes: prepared.bytes,
  }
}

function compressedReferenceFileName(name: string) {
  const base = String(name || '').replace(/\.[^.]+$/, '').trim() || 'reference'
  return `${base}.webp`
}

function removeReference(id: number) {
  references.value = references.value.filter((asset) => asset.id !== id)
}

function applyVideoModelConstraints() {
  const profile = videoModelProfile.value
  durationSeconds.value = clampDuration(durationSeconds.value)
  if (!profile.resolutions.includes(resolution.value)) {
    resolution.value = profile.resolutions[0] || '720p'
  }
  if (!profile.aspectRatios.includes(aspectRatio.value)) {
    aspectRatio.value = profile.aspectRatios[0] || '16:9'
  }

  references.value = references.value
    .filter((asset) => asset.kind !== 'image')
    .concat(
      references.value
        .filter((asset) => asset.kind === 'image')
        .slice(0, profile.maxImages)
        .map((asset): VideoReferenceAsset => {
          if (asset.role === 'last_frame' && !profile.modes.includes('first-last-frame')) {
            return { ...asset, role: 'first_frame' as const }
          }
          if (asset.role === 'reference_image' && !profile.modes.includes('reference-images')) {
            return { ...asset, role: 'first_frame' as const }
          }
          return asset
        }),
    )
    .map((asset): VideoReferenceAsset => {
      if (asset.kind !== 'video') return asset
      const role = asset.role === 'video_extension' ? 'video_extension' : 'video_edit'
      if (role === 'video_extension' && !profile.modes.includes('video-extension')) {
        return { ...asset, role: 'video_edit' as const }
      }
      if (role === 'video_edit' && !profile.modes.includes('video-edit')) {
        return { ...asset, role: undefined }
      }
      return { ...asset, role }
    })
    .filter((asset) => asset.kind !== 'video' || profile.maxVideos > 0)
    .filter((asset) => asset.kind !== 'audio' || maxAudios.value > 0)
    .slice(0, profile.maxImages + profile.maxVideos + maxAudios.value)

  if (!supportsGenerateAudioToggle.value) generateAudio.value = false
  if (!referenceKindOptions.value.some((option) => option.value === referenceKind.value)) {
    referenceKind.value = referenceKindOptions.value[0]?.value || 'image'
  }
  if (!imageRoleOptions.value.some((option) => option.value === referenceRole.value)) {
    referenceRole.value = imageRoleOptions.value[0]?.value || 'first_frame'
  }
  if (!videoRoleOptions.value.some((option) => option.value === videoReferenceRole.value)) {
    videoReferenceRole.value = videoRoleOptions.value[0]?.value || 'video_edit'
  }
}

/* -------------------------------- 生成流程 -------------------------------- */

function normalizeDuration() {
  durationSeconds.value = clampDuration(Number(durationSeconds.value))
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 5
  const rounded = Math.min(Math.max(Math.round(value), MIN_DURATION.value), MAX_DURATION.value)
  const allowed = videoModelProfile.value.durationOptions
  if (!allowed?.length || allowed.includes(rounded)) return rounded
  return allowed.reduce((nearest, option) => {
    const distance = Math.abs(option - rounded)
    const nearestDistance = Math.abs(nearest - rounded)
    return distance < nearestDistance || (distance === nearestDistance && option < nearest)
      ? option
      : nearest
  }, allowed[0])
}

function normalizeTaskCount() {
  taskCount.value = clampTaskCount(Number(taskCount.value))
}

function clampTaskCount(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(Math.round(value), 1), MAX_TASK_COUNT)
}

function videoSizeLabel(aspectRatioValue: string, resolutionValue: string): string {
  const ratio = VIDEO_ASPECT_RATIOS.find((item) => item.value === aspectRatioValue) || VIDEO_ASPECT_RATIOS[0]
  const orientation = ratio.value === '9:16' || ratio.value === '3:4'
    ? '竖屏'
    : ratio.value === '1:1'
      ? '方形'
      : ratio.value === '21:9'
        ? '宽屏'
        : '横屏'
  const longEdge = resolutionValue === '1080p' ? 1920 : resolutionValue === '720p' ? 1280 : 854
  const [ratioWidth, ratioHeight] = ratio.value.split(':').map(Number)
  let width = longEdge
  let height = longEdge
  if (ratioWidth >= ratioHeight) {
    height = Math.round((longEdge * ratioHeight) / ratioWidth)
  } else {
    width = Math.round((longEdge * ratioWidth) / ratioHeight)
  }
  return `${orientation} ${width}×${height}`
}

async function generate() {
  if (!canGenerate.value) return

  const model = effectiveModel.value
  const baseUrl = effectiveBaseUrl.value
  const provider = resolveVideoProvider(model, {
    baseUrl,
    platform: providerMode.value === 'platform' ? selectedKey.value?.group?.platform : '',
  })
  const platformKey = providerMode.value === 'platform' ? selectedKey.value : null
  const apiKeyRef = effectiveApiKey.value
  const count = clampTaskCount(Number(taskCount.value))
  const referencesSnapshot = references.value.slice()
  const newTasks: StudioTask[] = []

  errorMessage.value = ''
  let preparedReferences = referencesSnapshot
  if (referencesSnapshot.some((asset) =>
    (asset.kind === 'image' && asset.url.startsWith('data:image/')) ||
    (asset.kind === 'video' && asset.url.startsWith('data:video/')) ||
    (asset.kind === 'audio' && asset.url.startsWith('data:audio/')),
  )) {
    preparingReferences.value = true
    try {
      preparedReferences = await materializeVideoReferences(referencesSnapshot)
    } catch (error) {
      errorMessage.value = errorMessageFrom(error, '参考素材上传失败')
      return
    } finally {
      preparingReferences.value = false
    }
  }
  const displayOrderBase = allocateVideoBatchDisplayOrder(count)
  for (let index = 0; index < count; index += 1) {
    const task: StudioTask = {
      localId: createVideoWorkId(),
      provider,
      requestId: '',
      sourceId: '',
      keyId: platformKey?.id ?? 0,
      baseUrl,
      apiKeyRef,
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
      createdAt: Date.now() - index,
      displayOrder: displayOrderBase - index,
    }
    newTasks.push(task)
    saveVideoWork(recordFromTask(task, 'queued', '正在提交任务'))
  }
  tasks.value.unshift(...newTasks)
  const trackedTasks = tasks.value.slice(0, newTasks.length)
  works.value = listVideoWorks()
  await Promise.all(
    trackedTasks.map((task) =>
      runTask(task, {
        key: platformKey,
        baseUrl,
        apiKey: apiKeyRef,
        references: preparedReferences,
      }),
    ),
  )
}

async function runTask(
  task: StudioTask,
  submission: { key: ApiKey | null; baseUrl: string; apiKey: string; references: VideoReferenceAsset[] } | null,
) {
  // 恢复历史任务时没有 submission：此时只能用本站密钥（自定义渠道的密钥不落盘）。
  const resumedKey = submission ? null : resolveSelectedKey(task.keyId)
  const baseUrl = submission?.baseUrl || task.baseUrl || apiBaseUrl.value
  const apiKey = submission?.apiKey || task.apiKeyRef || resumedKey?.key || ''
  if (!apiKey) {
    task.status = 'failed'
    task.stageText = '生成失败'
    task.error = '找不到发起任务时使用的密钥，请重新生成。'
    persistTask(task, 'failed', task.error)
    return
  }
  if (!baseUrl) {
    task.status = 'failed'
    task.stageText = '生成失败'
    task.error = 'API 端点不可用，请检查站点设置。'
    persistTask(task, 'failed', task.error)
    return
  }

  activeGenerations.value += 1
  const context = {
    baseUrl,
    apiKey,
    platform: task.provider === 'grok' ? 'grok' : 'openai',
  }
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
      }, task.provider)
      task.requestId = created.requestId
      task.provider = created.provider
      task.sourceId = archiveSourceID(task.provider, task.requestId, task.localId)
      task.stageText = '排队中'
      persistTask(task, 'queued', '排队中')
    }

    const snapshot = await pollVideoTask(context, task.provider, task.requestId, {
      model: task.model,
      isCancelled: () => cancelledTasks.has(task.localId),
      onProgress: (progress) => {
        task.status = progress.status
        task.stageText = progress.progress > 0 && progress.status !== 'succeeded'
          ? `生成中 ${progress.progress}%`
          : statusText(progress.status)
      },
      onRetry: () => {
        task.stageText = '网络波动，正在自动重连'
      },
    })

    if (cancelledTasks.has(task.localId)) {
      await cancelVideoTask(context, task.provider, task.requestId)
      return
    }

    if (snapshot.status === 'succeeded') {
      const playable = await fetchVideoPlayableUrl(context, task.provider, task.requestId, snapshot.videoUrl, task.model)
      task.videoUrl = playable.url
      task.revokeUrl = playable.revoke
      task.status = 'succeeded'
      task.stageText = '已完成'
      task.error = ''
      persistTask(task, 'succeeded', '')
      // 归档到对象存储（失败不影响本次结果，本地记录仍然可用）。
      void archiveTaskVideo(task, snapshot.videoUrl)
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
  // 本会话内发起的任务还留着渠道密钥，用它继续查询，避免自定义渠道丢密钥。
  const submission = task.apiKeyRef
    ? { key: null, baseUrl: task.baseUrl, apiKey: task.apiKeyRef, references: [] }
    : null
  await runTask(task, submission)
}

// 归档成对象存储的长期地址：换浏览器/清缓存后「我的作品」还能播放。
// 只有公开可抓的 Seedance 直链交给服务端；需要 Bearer Key 的 Momo/Grok
// 内容接口先在浏览器下载字节，再上传归档。
async function archiveTaskVideo(task: StudioTask, upstreamUrl: string) {
  archiveHint.value = ''
  try {
    const sourceId = task.sourceId || taskArchiveSourceID(task)
    const request = {
      source_id: sourceId,
      prompt: task.prompt,
      model: task.model,
      format: 'mp4',
      duration_seconds: task.durationSeconds,
      created_at: Math.floor(task.createdAt / 1000),
      sort_order: task.displayOrder,
      // 工作台的内容先进临时档（到期自动删）；用户到「我的作品」里点保存才转永久。
      saved: false,
    }
    let entry: ArchivedVideoEntry
    if (task.provider === 'seedance' && /^https?:\/\//i.test(upstreamUrl)) {
      entry = await archiveVideo({ ...request, video_url: upstreamUrl })
    } else {
      const dataURL = await blobUrlToDataURL(task.videoUrl)
      if (!dataURL) {
        archiveHint.value = '视频较大，未自动归档；可在「我的作品」里手动下载保留。'
        return
      }
      entry = await archiveVideo({ ...request, video_data_url: dataURL })
    }
    if (!entry?.url) return
    // 旧 blob 先留着：DOM 还指着它，立即撤销会让正在播放的视频黑掉。
    if (task.revokeUrl && task.videoUrl) retiredObjectURLs.push(task.videoUrl)
    task.videoUrl = entry.url
    task.revokeUrl = false
    task.sourceId = entry.source_id || sourceId
    task.archivedId = entry.id
    task.archivedSaved = entry.saved
    task.archivedExpiresAt = entry.expires_at
    updateVideoWork(task.localId, {
      videoUrl: entry.url,
      sourceId: task.sourceId,
      archivedId: entry.id,
      archivedUrl: entry.url,
      archivedSaved: entry.saved,
      archivedExpiresAt: entry.expires_at,
    })
    tasks.value = tasks.value.filter((candidate) =>
      candidate.localId === task.localId || candidate.archivedId !== entry.id,
    )
    works.value = listVideoWorks()
  } catch (error) {
    // 常见原因是对象存储没启用；说清楚而不是静默。
    const reason = typeof error === 'object' && error !== null && 'reason' in error
      ? String((error as { reason?: unknown }).reason || '')
      : ''
    if (
      !authStore.isAdmin &&
      (reason === 'IMAGE_STORAGE_DISABLED' || reason === 'IMAGE_STORAGE_INCOMPLETE')
    ) {
      archiveHint.value = ''
      return
    }
    archiveHint.value = isStudioQuotaError(error)
      ? '视频已生成，但你的作品已达上限，请先到「我的作品」删除一些再归档。'
      : reason === 'IMAGE_STORAGE_DISABLED' || reason === 'IMAGE_STORAGE_INCOMPLETE'
        ? '视频已生成，但未归档到对象存储：请在后台「设置 → 数据备份」开启并补齐「异步生图对象存储」。'
        : `视频已生成，但归档失败：${errorMessageFrom(error, '未知原因')}`
  }
}

async function saveArchivedTask(task: StudioTask) {
  if (!task.archivedId || task.archivedSaved) return
  errorMessage.value = ''
  try {
    await pinArchivedVideo(task.archivedId)
    task.archivedSaved = true
    task.archivedExpiresAt = 0
    updateVideoWork(task.localId, {
      archivedSaved: true,
      archivedExpiresAt: 0,
    })
    works.value = listVideoWorks()
    appStore.showSuccess('已保存到我的作品')
  } catch (error) {
    errorMessage.value = isStudioQuotaError(error)
      ? '我的作品已满，请先删除一些内容再保存。'
      : '保存到我的作品失败'
  }
}

async function blobUrlToDataURL(url: string): Promise<string | null> {
  const response = await fetch(url)
  const blob = await response.blob()
  // base64 会膨胀 1/3，过大的视频不自动上传，避免卡住页面。
  if (blob.size > 96 * 1024 * 1024) return null
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取视频失败'))
    reader.readAsDataURL(blob)
  })
}

async function discardTask(task: StudioTask) {
  if (task.archivedId) {
    try {
      await deleteArchivedVideo(task.archivedId)
    } catch (error) {
      errorMessage.value = errorMessageFrom(error, '删除视频失败')
      return
    }
  }
  cancelledTasks.add(task.localId)
  if (task.revokeUrl && task.videoUrl) URL.revokeObjectURL(task.videoUrl)
  tasks.value = tasks.value.filter((item) => item.localId !== task.localId)
  works.value = removeVideoWork(task.localId)
  if (previewTask.value?.localId === task.localId) previewTask.value = null
}

function requestDiscardTask(task: StudioTask) {
  deleteTaskCandidate.value = task
}

async function confirmDiscardTask() {
  const task = deleteTaskCandidate.value
  deleteTaskCandidate.value = null
  if (task) await discardTask(task)
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

async function copyComposerPrompt() {
  const text = prompt.value.trim()
  if (!text) return
  await copyToClipboard(text, '提示词已复制')
}

async function pasteComposerPrompt() {
  try {
    const text = await navigator.clipboard.readText()
    if (text.trim()) prompt.value = text
  } catch {
    errorMessage.value = '无法读取剪贴板，请直接在提示词框中粘贴。'
  }
}

function closePreview() {
  previewTask.value = null
}

watch([selectedKeyId, apiBaseUrl, () => selectedKey.value?.key], () => {
  void loadModels()
})

watch(videoModelProfile, applyVideoModelConstraints, { immediate: true })

watch(selectedKeyId, (keyId) => {
  writePreferredKeyId(keyId)
  notifyCreatorKeyChanged('video', keyId)
})

watch(
  [
    providerMode,
    videoModel,
    customModel,
    resolution,
    aspectRatio,
    durationSeconds,
    taskCount,
    generateAudio,
  ],
  () => {
    writeVideoStudioPreferences({
      providerMode: providerMode.value,
      videoModel: videoModel.value.trim(),
      customModel: customModel.value.trim(),
      resolution: resolution.value,
      aspectRatio: aspectRatio.value,
      durationSeconds: Number(durationSeconds.value),
      taskCount: Number(taskCount.value),
      generateAudio: generateAudio.value,
    })
  },
  { flush: 'post' },
)

watch([customBaseUrl, customModel], () => {
  if (providerMode.value === 'custom') persistProviderSettings()
})

watch(prompt, (value) => {
  videoStudioDraft.initialized = true
  videoStudioDraft.prompt = value
})

watch(
  references,
  (value) => {
    videoStudioDraft.initialized = true
    videoStudioDraft.references = value.map((item) => ({ ...item }))
  },
  { deep: true, flush: 'post' },
)

// 灵感参数与未完成任务只在进入页面时处理一次：刷新密钥/模型不能覆盖用户
// 已经改过的提示词，也不能把同一份未完成任务重复挂起来。
onMounted(async () => {
  restoreProviderSettings()
  await loadData()
  applyInspirationFromRoute()
  resumeWorks()
  await loadArchivedResults()
})

onBeforeUnmount(() => {
  if (generationClockTimer) window.clearInterval(generationClockTimer)
  for (const task of tasks.value) {
    if (task.revokeUrl && task.videoUrl) URL.revokeObjectURL(task.videoUrl)
  }
  for (const url of retiredObjectURLs) URL.revokeObjectURL(url)
})
</script>

<style scoped>
.video-studio {
  display: flex;
  height: calc(100vh - 8rem - 1px);
  min-height: 0;
  width: 100%;
  /* 与图片工作台保持同宽，否则两个工作台来回切换会有明显的宽度差。 */
  max-width: 120rem;
  margin: 0 auto;
  overflow: hidden;
  flex-direction: column;
  gap: 1rem;
}

.video-studio__header {
  display: flex;
  flex-shrink: 0;
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

.toolbar-field--select {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.4rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.6rem;
  background: rgb(255 255 255);
  padding: 0 0.55rem;
}

.toolbar-field--select > span {
  font-size: 0.75rem;
}

.toolbar-field--select:focus-within {
  border-color: rgb(232 121 78);
}

.toolbar-field--select :deep(.studio-select__trigger) {
  height: 2.1rem;
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.toolbar-field--select :deep(.studio-select__trigger:hover),
.toolbar-field--select :deep(.studio-select--open .studio-select__trigger) {
  border: 0;
  box-shadow: none;
}

.toolbar-field--select :deep(.studio-select__menu) {
  width: 100%;
  max-width: 100%;
}

.toolbar-field__select {
  min-width: 9rem;
}

.toolbar-field__select--model {
  min-width: 13rem;
}

.provider-switch {
  align-items: center;
}

.toolbar-input {
  height: 1.8rem;
  width: 9rem;
  border: 0;
  background: transparent;
  font-size: 0.82rem;
  color: rgb(30 41 59);
  outline: none;
}

.toolbar-input--url {
  width: 14rem;
}

.toolbar-input--model {
  width: 11rem;
}

.toolbar-input::placeholder {
  color: rgb(148 163 184);
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

.toolbar-link em {
  border-radius: 9999px;
  background: rgb(255 227 214);
  padding: 0 0.35rem;
  font-style: normal;
  font-size: 0.7rem;
  color: rgb(173 74 41);
}

.is-spinning {
  animation: video-spin 0.9s linear infinite;
}

.video-studio__stage {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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

.studio-results__actions {
  display: flex;
  min-width: 0;
  flex-shrink: 0;
  align-items: center;
  gap: 0.65rem;
}

.video-generation-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 9999px;
  background: rgb(240 253 250);
  padding: 0.3rem 0.58rem;
  color: rgb(15 118 110);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .video-generation-status span {
    display: none;
  }
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

.video-card__archive-state {
  margin-top: 0.3rem;
  font-size: 0.72rem;
}

.video-card__archive-state--saved {
  color: rgb(5 150 105);
}

.video-card__archive-state--temp {
  color: rgb(217 119 6);
}

.video-card__actions {
  display: flex;
  gap: 0.25rem;
  padding: 0 0.6rem 0.6rem;
}

.video-card__delete {
  margin-left: auto;
  border-color: rgb(254 202 202);
  color: rgb(185 28 28);
}

.video-card__delete:hover {
  border-color: rgb(239 68 68);
  background: rgb(254 242 242);
  color: rgb(220 38 38);
}

.delete-task-confirm {
  display: grid;
  gap: 0.45rem;
  color: rgb(51 65 85);
  font-size: 0.9rem;
}

.delete-task-confirm p:last-child {
  color: rgb(100 116 139);
  font-size: 0.8rem;
}

.delete-task-confirm__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}

.danger-button {
  display: inline-flex;
  height: 2.35rem;
  align-items: center;
  border-radius: 0.75rem;
  background: rgb(220 38 38);
  padding: 0 0.9rem;
  color: white;
}

.danger-button:hover {
  background: rgb(185 28 28);
}

.video-composer {
  flex-shrink: 0;
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

.video-composer__prompt-wrap {
  position: relative;
}

.video-composer__prompt {
  width: 100%;
  min-height: 4.5rem;
  max-height: clamp(8rem, 28vh, 12.5rem);
  resize: vertical;
  border: 0;
  background: transparent;
  padding-right: 2.5rem;
  line-height: 1.65;
  overflow-y: hidden;
  transition: height 0.16s ease;
  font-size: 0.875rem;
  color: rgb(17 24 39);
  outline: none;
}

.video-composer__prompt-toggle {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: inline-flex;
  height: 1.75rem;
  width: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.4rem;
  background: transparent;
  color: rgb(148 163 184);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.video-composer__prompt-toggle:hover {
  background: rgb(241 245 249);
  color: rgb(173 74 41);
}

.video-composer__prompt::placeholder {
  color: rgb(156 163 175);
}

.video-composer__prompt-meta {
  display: flex;
  justify-content: flex-end;
  font-size: 0.7rem;
  color: rgb(148 163 184);
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
  border-color: rgb(232 121 78);
}

.control-button em {
  border-radius: 9999px;
  background: rgb(255 227 214);
  padding: 0 0.35rem;
  font-style: normal;
  font-size: 0.7rem;
  color: rgb(173 74 41);
}

.control-toggle--on {
  border-color: rgb(232 121 78);
  background: rgb(255 244 238);
  color: rgb(173 74 41);
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
  background: rgb(255 244 238);
  color: rgb(173 74 41);
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
  border-color: rgb(232 121 78);
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
  color: rgb(173 74 41);
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
  color: rgb(242 237 229);
}

:global(.dark .toolbar-field--select) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  padding: 0 0.55rem;
}

:global(.dark .toolbar-field),
:global(.dark .toolbar-link),
:global(.dark .video-composer),
:global(.dark .control-button),
:global(.dark .control-toggle),
:global(.dark .mini-action),
:global(.dark .secondary-button),
:global(.dark .count-stepper),
:global(.dark .text-input),
:global(.dark .toolbar-input) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(227 219 208);
}

:global(.dark .toolbar-field--select) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  padding: 0 0.55rem;
}

:global(.dark .video-studio__stage) {
  border-color: rgb(66 61 55);
  background: rgb(29 28 25);
}

:global(.dark .video-card) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
}

:global(.dark .video-card__prompt) {
  color: rgb(242 237 229);
}

:global(.dark .video-composer__prompt) {
  color: rgb(242 237 229);
}

:global(.dark .video-composer__prompt-toggle) {
  border: 0;
  background: transparent;
  color: rgb(167 159 148);
}

:global(.dark .video-composer__prompt-toggle:hover) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .preview__prompt) {
  color: rgb(227 219 208);
}

:global(.dark .preview__meta dt) {
  color: rgb(167 159 148);
}

:global(.dark .preview__meta dd) {
  color: rgb(242 237 229);
}

:global(.dark .reference-chip) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
}

:global(.dark .video-studio__empty-icon) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(167 159 148);
}

:global(.dark .video-card__media) {
  background: rgb(20 19 18);
}

:global(.dark .video-generation-status) {
  background: rgb(19 78 74 / 0.45);
  color: rgb(153 246 228);
}

:global(.dark .segmented) {
  background: rgb(35 33 30);
}

:global(.dark .segmented__item--active) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .control-toggle--on) {
  border-color: rgb(232 121 78);
  background: rgb(232 121 78 / 0.12);
  color: rgb(245 161 127);
}

.video-composer {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border: 0;
  border-radius: 0;
  background: rgb(255 255 255);
  box-shadow: none;
}

.video-composer > * {
  flex-shrink: 0;
}

.video-composer__prompt-shell {
  position: relative;
  z-index: 2;
  overflow: visible;
  border: 1px solid rgb(235 235 233);
  border-radius: 1.2rem;
  background: rgb(248 248 246);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.8);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.video-composer__prompt-shell:focus-within {
  border-color: rgb(208 208 204);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.9),
    0 8px 24px rgb(24 24 27 / 0.05);
}

.video-composer__prompt {
  display: block;
  width: 100%;
  height: 9rem;
  min-height: 9rem;
  max-height: min(36rem, 65vh);
  resize: none;
  overflow-y: auto;
  border: 0;
  background: transparent;
  padding: 0.75rem 0.85rem 0.25rem;
  color: rgb(31 31 30);
  font-size: 0.92rem;
  line-height: 1.72;
  outline: none;
}

.video-composer__prompt::placeholder {
  color: rgb(156 156 151);
}

.video-composer__prompt-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.65rem 0.18rem;
}

.video-composer__model {
  min-width: 0;
  max-width: none;
  flex: 1 1 auto;
}

.video-composer__model :deep(.studio-select__trigger) {
  min-width: 0;
  height: 2.2rem;
  border-color: rgb(226 226 222);
  border-radius: 999px;
  background: rgb(255 255 255);
  padding: 0 0.75rem;
  box-shadow: none;
  font-size: 0.8rem;
}

.video-composer__model :deep(.studio-select__trigger span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-composer__model :deep(.studio-select__trigger:hover),
.video-composer__model :deep(.studio-select--open .studio-select__trigger) {
  border-color: rgb(201 201 196);
  box-shadow: none;
}

.video-composer__model-input {
  min-width: 9.5rem;
  max-width: calc(100% - 8.25rem);
  height: 2.2rem;
  border: 1px solid rgb(226 226 222);
  border-radius: 999px;
  background: rgb(255 255 255);
  padding: 0 0.8rem;
  color: rgb(42 42 40);
  font-size: 0.8rem;
  outline: none;
}

.video-composer__prompt-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.1rem;
}

.video-composer__prompt-actions button,
.video-composer__section-head button {
  display: inline-flex;
  height: 2rem;
  width: 2rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.55rem;
  background: transparent;
  color: rgb(82 82 78);
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.video-composer__prompt-actions button:hover,
.video-composer__section-head button:hover {
  background: rgb(238 238 235);
  color: rgb(24 24 23);
}

.video-composer__prompt-meta {
  display: flex;
  justify-content: flex-end;
  padding: 0 0.75rem 0.5rem;
  font-size: 0.68rem;
  color: rgb(151 151 144);
}

.video-composer__references {
  border-radius: 0.8rem;
  padding: 0.1rem 0.15rem 0.35rem;
}

.video-composer__section-head {
  display: flex;
  min-height: 1.65rem;
  align-items: center;
  justify-content: space-between;
  color: rgb(42 42 40);
  font-size: 0.82rem;
  font-weight: 600;
}

.video-composer__reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4.9rem, 1fr));
  gap: 0.55rem;
  margin-top: 0.4rem;
}

.video-composer__reference,
.video-composer__upload-tile {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 0.8rem;
}

.video-composer__reference {
  border: 1px solid rgb(231 231 228);
  background: rgb(245 245 243);
}

.video-composer__reference > img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}

.video-composer__reference-glyph {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  color: rgb(82 82 78);
}

.video-composer__reference-glyph small {
  font-size: 0.68rem;
}

.video-composer__reference > button {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  display: flex;
  height: 1.5rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.4);
  border-radius: 999px;
  background: rgb(24 24 27 / 0.72);
  color: white;
}

.video-composer__upload-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgb(198 198 193);
  background: rgb(255 255 255);
  color: rgb(44 44 42);
  transition:
    border-color 0.16s ease,
    background 0.16s ease;
}

.video-composer__upload-tile:hover {
  border-color: rgb(109 109 103);
  background: rgb(249 249 247);
}

.video-composer__helper {
  margin-top: 0.4rem;
  font-size: 0.68rem;
  line-height: 1.55;
  color: rgb(142 142 136);
}

.video-composer__toggle-row {
  display: flex;
  min-height: 1.9rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: rgb(42 42 40);
  font-size: 0.82rem;
  font-weight: 600;
}

.video-composer__field {
  display: grid;
  gap: 0.35rem;
}

.video-composer__field-label {
  color: rgb(42 42 40);
  font-size: 0.78rem;
  font-weight: 600;
}

.video-composer__inline-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.video-composer__inline-field input {
  width: 5.3rem;
  height: 2.15rem;
  border: 1px solid rgb(231 231 228);
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  padding: 0 0.6rem;
  color: rgb(42 42 40);
  font-size: 0.82rem;
  outline: none;
  text-align: center;
}

.video-composer__inline-field input:focus {
  border-color: rgb(201 201 196);
  box-shadow: 0 0 0 3px rgb(24 24 27 / 0.05);
}

.video-composer__size-select {
  position: relative;
}

.video-composer__size-picker {
  min-width: 13.5rem;
}

.video-composer__size-select select {
  width: 100%;
  height: 2.35rem;
  appearance: none;
  border: 1px solid rgb(231 231 228);
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  padding: 0 2.25rem;
  color: rgb(54 54 51);
  font-size: 0.82rem;
  outline: none;
}

.video-composer__size-select select:focus {
  border-color: rgb(201 201 196);
  box-shadow: 0 0 0 3px rgb(24 24 27 / 0.05);
}

.video-composer__size-icon,
.video-composer__size-chevron {
  position: absolute;
  top: 50%;
  pointer-events: none;
  color: rgb(113 113 107);
  transform: translateY(-50%);
}

.video-composer__size-icon {
  left: 0.75rem;
}

.video-composer__size-chevron {
  right: 0.7rem;
}

.video-composer__audio-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: rgb(42 42 40);
  font-size: 0.78rem;
  font-weight: 600;
}

.video-composer__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.video-composer__label {
  color: rgb(42 42 40);
  font-size: 0.78rem;
  font-weight: 600;
}

.video-composer__value-label {
  color: rgb(113 113 107);
  font-size: 0.78rem;
}

.video-composer__segmented {
  display: grid;
  grid-template-columns: repeat(var(--video-segment-count, 1), minmax(0, 1fr));
  overflow: hidden;
  border-radius: 0.55rem;
  background: rgb(232 232 229);
}

.video-composer__segmented button {
  min-height: 2.15rem;
  border: 0;
  border-radius: 0.45rem;
  background: transparent;
  color: rgb(113 113 107);
  font-size: 0.82rem;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}

.video-composer__segmented button:hover {
  color: rgb(31 31 30);
}

.video-composer__segmented button.is-active {
  background: rgb(250 250 248);
  color: rgb(31 31 30);
  box-shadow:
    0 1px 2px rgb(24 24 27 / 0.08),
    0 0 0 1px rgb(24 24 27 / 0.03);
}

.video-composer__duration {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.3rem;
  gap: 0.55rem;
}

.video-composer__duration-custom {
  display: flex;
  height: 2.15rem;
  align-items: center;
  border: 1px solid rgb(231 231 228);
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  padding: 0 0.6rem;
  color: rgb(113 113 107);
  font-size: 0.78rem;
}

.video-composer__duration-custom input {
  width: 100%;
  border: 0;
  background: transparent;
  color: rgb(42 42 40);
  font-size: 0.82rem;
  outline: none;
  text-align: right;
}

.video-composer__footer {
  margin-top: 0.05rem;
  border-top: 1px solid rgb(239 239 236);
  padding-top: 0.7rem;
}

.video-composer__generate {
  display: inline-flex;
  width: 100%;
  min-height: 2.85rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 0;
  border-radius: 0.9rem;
  background: rgb(25 25 24);
  color: white;
  font-size: 0.92rem;
  font-weight: 600;
  transition:
    background 0.16s ease,
    transform 0.16s ease,
    opacity 0.16s ease;
}

.video-composer__generate:hover:not(:disabled) {
  background: rgb(45 45 43);
}

.video-composer__generate:active:not(:disabled) {
  transform: translateY(1px);
}

.video-composer__generate:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

:global(.dark .video-composer) {
  background: rgb(24 24 27);
}

:global(.dark .video-composer__prompt-shell) {
  border-color: rgb(54 54 51);
  background: rgb(35 35 33);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04);
}

:global(.dark .video-composer__prompt-shell:focus-within) {
  border-color: rgb(82 82 76);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.24);
}

:global(.dark .video-composer__prompt),
:global(.dark .video-composer__model-input) {
  color: rgb(244 244 242);
}

:global(.dark .video-composer__model-input) {
  border-color: rgb(64 64 60);
  background: rgb(46 46 43);
}

:global(.dark .video-composer__model .studio-select__trigger) {
  border-color: rgb(64 64 60) !important;
  background: rgb(46 46 43) !important;
  color: rgb(239 239 235) !important;
}

:global(.dark .video-composer__model .studio-select__trigger span) {
  color: rgb(239 239 235) !important;
}

:global(.dark .video-composer__prompt-actions button),
:global(.dark .video-composer__section-head button) {
  color: rgb(188 188 181);
}

:global(.dark .video-composer__prompt-actions button:hover),
:global(.dark .video-composer__section-head button:hover) {
  background: rgb(48 48 45);
  color: rgb(247 247 243);
}

:global(.dark .video-composer__section-head),
:global(.dark .video-composer__toggle-row),
:global(.dark .video-composer__label) {
  color: rgb(236 236 232);
}

:global(.dark .video-composer__reference) {
  border-color: rgb(62 62 58);
  background: rgb(38 38 36);
}

:global(.dark .video-composer__reference-glyph) {
  color: rgb(210 210 204);
}

:global(.dark .video-composer__upload-tile),
:global(.dark .video-composer__duration-custom),
:global(.dark .video-composer__size-select select),
:global(.dark .video-composer__inline-field input) {
  border-color: rgb(70 70 65);
  background: rgb(38 38 36);
  color: rgb(232 232 227);
}

:global(.dark .video-composer__duration-custom input) {
  color: rgb(240 240 236);
}

:global(.dark .video-composer__segmented) {
  background: rgb(48 48 45);
}

:global(.dark .video-composer__segmented button) {
  color: rgb(166 166 159);
}

:global(.dark .video-composer__segmented button.is-active) {
  background: rgb(66 66 62);
  color: rgb(250 250 247);
}

:global(.dark .video-composer__field-label),
:global(.dark .video-composer__audio-row) {
  color: rgb(236 236 232);
}

:global(.dark .video-composer__size-icon),
:global(.dark .video-composer__size-chevron) {
  color: rgb(167 159 148);
}

:global(.dark .video-composer__footer) {
  border-color: rgb(54 54 51);
}

:global(.dark .video-composer__generate) {
  background: rgb(244 244 241);
  color: rgb(24 24 23);
}

:global(.dark .video-composer__generate:hover:not(:disabled)) {
  background: rgb(226 226 221);
}

@media (max-width: 480px) {
  .video-composer {
    padding-right: 0.65rem;
    padding-left: 0.65rem;
  }

  .video-composer__prompt {
    height: 7.75rem;
    min-height: 7.75rem;
    max-height: min(28rem, 60vh);
    padding: 0.75rem 0.8rem 0.2rem;
    font-size: 0.88rem;
  }

  .video-composer__prompt-footer {
    padding-right: 0.6rem;
    padding-left: 0.6rem;
  }

  .video-composer__model,
  .video-composer__model-input {
    min-width: 0;
    max-width: none;
  }

  .video-composer__prompt-actions button {
    height: 1.9rem;
    width: 1.9rem;
  }

  .video-composer__reference-grid {
    grid-template-columns: repeat(auto-fill, minmax(4.6rem, 1fr));
  }

  .video-composer__duration {
    grid-template-columns: minmax(0, 1fr) 4.8rem;
  }
}

.video-studio.studio-page {
  display: grid;
  gap: 0;
  max-width: none;
  margin: 0;
}

.video-studio .studio-page__header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 0.85rem;
}

.video-studio .studio-page__header .video-studio__title h1 {
  font-size: 1.35rem;
}

.video-studio .studio-page__header .video-studio__title p {
  font-size: 0.78rem;
}

.video-studio .studio-page__header .video-studio__toolbar {
  align-items: stretch;
}

.video-studio .studio-page__composer {
  padding: 0 1rem 1rem;
  border-radius: 0;
  box-shadow: none;
}

.video-studio .studio-page__results {
  border: 0;
  border-radius: 0;
  margin: 0;
  padding: 0;
}

.video-studio .studio-page__results .video-grid {
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1rem;
}

.video-studio .studio-page__header .toolbar-link {
  display: none;
}

.video-studio .studio-page__results .video-card {
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.03);
}

.video-studio .studio-page__results .video-studio__empty {
  min-height: 100%;
}

@media (max-width: 1024px) {
  .video-studio.studio-page {
    display: grid;
    height: auto;
  }

  .video-studio .studio-page__header {
    padding-bottom: 1rem;
  }
}

:global(.dark .video-studio .studio-page__results .video-card) {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27);
}
</style>
