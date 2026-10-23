<template>
  <AppLayout>
    <div class="image-studio studio-page">
      <div class="studio-page__nav xl:hidden"><StudioNav /></div>
      <header class="studio-page__header">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">生图工作台</h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <label class="toolbar-field toolbar-field--select">
            <span>API Key</span>
            <ImageStudioSelect
              v-model="selectedKeyId"
              class="toolbar-image-select"
              data-testid="api-key-select"
              :options="apiKeyOptions"
              :placeholder="'选择密钥'"
              direction="down"
            />
          </label>
          <button
            type="button"
            class="mini-action"
            data-testid="image-refresh"
            title="刷新密钥和模型"
            :disabled="refreshing"
            @click="refreshAll"
          >
            <Icon name="refresh" size="sm" :class="{ 'is-spinning': refreshing }" />
          </button>
          <span v-if="modelLoadError" class="toolbar-error">{{ modelLoadError }}</span>
        </div>
      </header>

      <section class="studio-page__results">
        <div class="studio-results__head">
          <div class="studio-results__title">
            <Icon name="grid" size="sm" />
            <h2>全部结果</h2>
            <span>{{ images.length }}</span>
          </div>
          <div class="studio-results__actions">
            <span
              v-if="activeImageTaskCount > 0"
              class="image-generation-status"
              data-testid="image-active-generations"
              aria-live="polite"
            >
              <Icon name="refresh" size="xs" class="is-spinning" />
              <span>{{ activeImageTaskCount }} 个任务进行中</span>
            </span>
            <button type="button" class="studio-results__action" :disabled="refreshing" @click="loadGallery">
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': refreshing }" />
              <span>加载历史记录</span>
            </button>
          </div>
        </div>
        <div class="studio-results__body">
        <div v-if="!images.length" class="flex min-h-[22rem] flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 dark:border-dark-700 dark:bg-dark-800">
            <Icon name="sparkles" size="xl" />
          </div>
          <p class="mt-4 font-medium text-gray-700 dark:text-gray-200">输入提示词开始生成图片</p>
          <p class="mt-1 text-sm">支持文生图，也可以上传参考图做图生图。</p>
        </div>

        <div v-else class="image-results-grid" data-testid="image-results-grid">
          <article
            v-for="image in images"
            :key="image.id"
            class="group overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-dark-700 dark:bg-dark-800"
          >
            <button
              type="button"
              class="image-result-card__media relative block w-full overflow-hidden"
              :disabled="image.pending"
              @click="!image.pending && (previewImage = image)"
            >
              <div v-if="image.pending" class="image-pending-card">
                <span class="image-generation-spinner" aria-hidden="true"></span>
                <strong>正在生成</strong>
                <small>刷新或切换页面不会中断，完成后将在此显示</small>
                <small class="image-pending-card__timer" data-testid="image-pending-timer">
                  {{ pendingElapsedSeconds(image) }} 秒
                </small>
              </div>
              <template v-else>
                <div
                  v-if="!isImageMediaLoaded(image)"
                  class="image-media-state"
                  :class="{ 'image-media-state--error': isImageMediaFailed(image) }"
                  :data-testid="isImageMediaFailed(image) ? 'image-media-error' : 'image-media-loading'"
                >
                  <span v-if="!isImageMediaFailed(image)" class="image-generation-spinner" aria-hidden="true"></span>
                  <strong>{{ isImageMediaFailed(image) ? '图片加载失败' : '图片加载中' }}</strong>
                  <small>{{ isImageMediaFailed(image) ? '点击查看详情并重试' : '正在加载缩略图' }}</small>
                </div>
                <img
                  v-if="!isImageMediaFailed(image)"
                  :key="imageMediaRenderKey(image)"
                  :src="imageMediaDisplaySrc(image)"
                  :srcset="image.thumbSrcSet"
                  :alt="image.title"
                  loading="lazy"
                  decoding="async"
                  class="absolute inset-0 block h-full w-full object-cover"
                  :class="{ 'opacity-0': !isImageMediaLoaded(image) }"
                  @load="markImageMediaLoaded(image)"
                  @error="handleImageMediaError(image)"
                />
              </template>
            </button>
              <div class="flex items-center justify-between gap-2 px-3 py-2">
                <div class="min-w-0">
                  <p class="truncate text-[11px] text-gray-400">
                    {{ image.createdAt ? `${formatCreatedAt(image.createdAt)} · ${image.meta}` : image.meta }}
                  </p>
                  <p
                    v-if="!image.pending && image.saved"
                    class="text-xs text-emerald-600 dark:text-emerald-400"
                    data-testid="image-saved-badge"
                  >
                    已保存到我的作品
                  </p>
                  <p
                    v-else-if="!image.pending && image.expiresAt"
                    class="text-xs text-amber-600 dark:text-amber-400"
                    data-testid="image-temp-badge"
                  >
                    临时内容 · 还剩 {{ remainingDays(image) }} 天
                  </p>
                </div>
                <div v-if="!image.pending" class="flex shrink-0 gap-1">
                  <button
                    v-if="!image.saved && galleryBackedIds.has(galleryIdFor(image))"
                    type="button"
                    class="mini-action"
                    data-testid="image-pin"
                    title="存到我的作品（长期保留）"
                    @click="pinImage(image)"
                  >
                    <Icon name="bookmark" size="sm" />
                  </button>
                  <button type="button" class="mini-action" title="下载图片" @click="downloadImage(image)">
                    <Icon name="download" size="sm" />
                  </button>
                  <button
                    v-if="galleryBackedIds.has(galleryIdFor(image))"
                    type="button"
                    class="mini-action"
                    data-testid="gallery-image-delete"
                    title="删除作品（同时删除存储里的文件）"
                    @click="removeGalleryImage(image)"
                  >
                    <Icon name="trash" size="sm" />
                  </button>
                </div>
              </div>
          </article>
        </div>
        </div>
      </section>

      <form class="studio-page__composer image-composer" @submit.prevent="generate">
        <section class="image-composer__prompt-shell">
          <textarea
            ref="promptTextareaRef"
            v-model="prompt"
            rows="5"
            class="image-composer__prompt"
            :style="{ height: promptHeight }"
            placeholder="描述画面主体、风格、构图、光线和用途"
            @paste="onPaste"
          />
          <div class="image-composer__prompt-footer">
            <ImageStudioSelect
              v-model="imageModel"
              class="image-composer__model"
              data-testid="image-model-select"
              :options="imageModelOptions"
              :disabled="loadingModels || imageModels.length === 0"
              :placeholder="modelSelectPlaceholder"
              direction="down"
            />
            <div class="image-composer__prompt-actions">
              <button type="button" title="复制提示词" @click="copyComposerPrompt">
                <Icon name="copy" size="sm" />
              </button>
              <button type="button" title="从剪贴板粘贴" @click="pasteComposerPrompt">
                <Icon name="clipboard" size="sm" />
              </button>
              <button type="button" title="清空提示词" @click="prompt = ''">
                <Icon name="trash" size="sm" />
              </button>
              <button type="button" title="上传参考图" @click="fileInput?.click()">
                <Icon name="paperclip" size="sm" />
              </button>
            </div>
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
          class="image-composer__references"
          @dragover.prevent
          @drop.prevent="onDropReferences"
        >
          <div class="image-composer__section-head">
            <span>参考图</span>
            <button type="button" title="上传参考图" aria-label="上传参考图" @click="fileInput?.click()">
              <Icon name="upload" size="sm" />
            </button>
          </div>
          <div class="image-composer__reference-grid" data-testid="image-reference-grid">
            <div
              v-for="(item, index) in references"
              :key="item.id"
              class="image-composer__reference"
              :data-testid="`image-reference-${index + 1}`"
            >
              <img :src="item.preview" :alt="item.name" />
              <button
                type="button"
                class="image-composer__reference-index"
                :data-testid="`reference-index-${index + 1}`"
                :title="`插入图片${index + 1}引用`"
                @click.stop="insertReferenceToken(index + 1)"
              >
                图片 {{ index + 1 }}
              </button>
              <span class="image-composer__reference-name" :title="item.name">{{ item.name }}</span>
              <button
                type="button"
                class="image-composer__remove"
                :aria-label="`移除 ${item.name}`"
                @click.stop="removeReference(item.id)"
              >
                <Icon name="x" size="xs" />
              </button>
            </div>
            <button
              type="button"
              class="image-composer__upload-tile"
              title="添加参考图"
              aria-label="添加参考图"
              @click="fileInput?.click()"
            >
              <Icon name="plus" size="md" />
            </button>
          </div>
          <p class="image-composer__helper">
            可拖拽或粘贴参考图，最多 14 张。点击图片编号可把「图片1」等引用插入提示词。
          </p>
        </section>

        <p
          v-if="sizeIssue"
          class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="image-size-warning"
        >
          当前尺寸不可用：{{ sizeIssue }}。点左侧「尺寸」调整后再生成。
        </p>

        <div v-if="modelSupportsTransparentBackground" class="image-composer__toggle-row">
          <span>
            透明背景
          </span>
          <div
            title="仅模型支持透明通道时生效"
          >
            <Toggle v-model="transparentBackground" />
          </div>
        </div>

        <div
          class="image-composer__option-grid"
          :class="{ 'is-split': qualityDisplayOptions.length }"
        >
          <div v-if="qualityDisplayOptions.length" class="image-composer__field">
            <span class="image-composer__label">质量</span>
            <div class="image-composer__segmented" data-testid="quality-select" role="group" aria-label="质量">
              <button
                v-for="option in qualityDisplayOptions"
                :key="option.value"
                type="button"
                :class="{ 'is-active': quality === option.value }"
                @click="selectQuality(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="image-composer__field">
            <span class="image-composer__label">格式</span>
            <div
              class="image-composer__segmented image-composer__segmented--three"
              data-testid="image-format-control"
              role="group"
              aria-label="图片格式"
            >
              <button
                v-for="option in formatOptions"
                :key="option.value"
                type="button"
                :class="{ 'is-active': format === option.value }"
                @click="format = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="isGeminiImageModel" class="image-composer__option-note">
          质量会按高 4K、中 2K、低 1K 发送；透明背景需要模型返回透明通道，当前 Gemini 接口不支持。
        </p>

        <div ref="sizeFieldRef" class="image-composer__field image-composer__size-field">
          <div class="image-composer__label-row">
            <span class="image-composer__label">尺寸</span>
            <button
              type="button"
              class="image-composer__text-action"
              aria-label="自定义尺寸"
              data-testid="image-custom-size-toggle"
              @click="toggleCustomSize"
            >
              {{ customSizeOpen ? '收起自定义' : '自定义尺寸' }}
            </button>
          </div>
          <div class="image-composer__size-row">
            <div class="image-composer__size-anchor">
              <button
                type="button"
                class="image-composer__select-like"
                data-testid="image-size-trigger"
                aria-label="尺寸"
                :aria-expanded="sizeMenuOpen"
                @click="toggleSizeMenu"
              >
                <span>{{ sizeDisplayLabel }}</span>
                <Icon name="chevronDown" size="sm" :class="{ 'rotate-180': sizeMenuOpen }" />
              </button>
              <div
                v-if="sizeMenuOpen"
                class="image-composer__size-menu"
                :class="{ 'is-up': sizeMenuPlacement === 'up' }"
                role="listbox"
                data-testid="image-size-menu"
              >
                <button
                  type="button"
                  class="image-composer__size-option"
                  data-testid="size-preset-auto"
                  @click="applyAutoSize"
                >
                  自动
                </button>
                <p class="image-composer__size-option-note">自动（由模型决定）</p>
                <template v-for="base in aspectBaseOptions" :key="base.value">
                  <p class="image-composer__size-group">{{ base.label }}</p>
                  <button
                    v-for="ratio in ratioOptions"
                    :key="`${base.value}-${ratio.value}`"
                    type="button"
                    class="image-composer__size-option"
                    :class="{ 'is-active': isRatioSelected(base.value, ratio.value) }"
                    :data-testid="`size-preset-${base.value}-${ratio.value}`"
                    @click="applyRatioPreset(base.value, ratio.value)"
                  >
                    <span class="image-composer__size-ratio-frame">
                      <span
                        class="image-composer__size-ratio-shape"
                        :style="ratioShapeStyle(ratio.value)"
                      />
                    </span>
                    <span>{{ sizeOptionLabel(ratio.value, base.value) }}</span>
                  </button>
                </template>
              </div>
            </div>
          </div>
          <div v-if="customSizeOpen" class="image-composer__custom-size" data-testid="image-custom-size-panel">
            <div class="image-composer__custom-size-toggle">
              <span>16 倍数对齐</span>
              <Toggle v-model="snapTo16Enabled" />
            </div>
            <div class="image-composer__dimension-row">
              <label class="image-composer__dimension">
                <span>W</span>
                <input
                  v-model.number="appliedSize.width"
                  data-testid="custom-width"
                  type="number"
                  min="256"
                  :max="maxImageEdge"
                  step="16"
                  aria-label="宽度"
                />
              </label>
              <span class="image-composer__dimension-x">×</span>
              <label class="image-composer__dimension">
                <span>H</span>
                <input
                  v-model.number="appliedSize.height"
                  data-testid="custom-height"
                  type="number"
                  min="256"
                  :max="maxImageEdge"
                  step="16"
                  aria-label="高度"
                />
              </label>
            </div>
            <p class="image-composer__custom-size-help">
              <template v-if="isGeminiImageModel">
                支持 auto（默认，由模型决定）或自定义分辨率。超过 3840px 的尺寸会在生成后本地处理，最长边不超过 {{ maxImageEdge }}px。
              </template>
              <template v-else>
                支持 auto（默认，由模型决定）或自定义分辨率。自定义需满足：最长边不超过
                3840px，宽高均为 16px 的倍数，长短边比不超过 3:1，总像素 655,360–8,294,400。
              </template>
            </p>
            <p class="image-composer__custom-size-summary" data-testid="custom-size-summary">
              当前 {{ customSizeSummary }}
            </p>
            <p v-if="sizeIssue" class="image-composer__custom-size-error" data-testid="size-dialog-issue">
              {{ sizeIssue }}
            </p>
          </div>
        </div>

        <div class="image-composer__field">
          <span class="image-composer__label">生成张数</span>
          <div class="image-composer__segmented" data-testid="image-count-control" role="group" aria-label="生成张数">
            <button
              v-for="value in [1, 2, 3, 4]"
              :key="value"
              type="button"
              :class="{ 'is-active': count === value }"
              @click="count = value"
            >
              {{ value }}
            </button>
          </div>
          <input
            v-model.number="count"
            type="number"
            min="1"
            max="4"
            aria-label="生成数量"
            class="sr-only"
            @blur="normalizeCount"
          />
        </div>

        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple class="hidden" @change="onFilesSelected" />

        <div class="image-composer__footer">
          <button type="submit" class="image-composer__generate" :disabled="!canGenerate">
            <Icon name="sparkles" size="sm" />
            {{ generating ? '继续生成' : '开始生成' }}
          </button>
        </div>
      </form>
    </div>

    <BaseDialog
      :show="!!previewImage"
      :title="previewImage?.title || '图片详情'"
      width="extra-wide"
      :close-on-click-outside="true"
      @close="previewImage = null"
    >
      <div v-if="previewImage" class="image-detail-dialog">
        <div class="image-detail-dialog__media">
          <div
            v-if="!isImageMediaLoaded(previewImage)"
            class="image-media-state image-detail-dialog__media-state"
            :class="{ 'image-media-state--error': isImageMediaFailed(previewImage) }"
            :data-testid="isImageMediaFailed(previewImage) ? 'preview-image-error' : 'preview-image-loading'"
          >
            <span v-if="!isImageMediaFailed(previewImage)" class="image-generation-spinner" aria-hidden="true"></span>
            <strong>{{ isImageMediaFailed(previewImage) ? '图片加载失败' : '图片加载中' }}</strong>
            <small>{{ isImageMediaFailed(previewImage) ? '原图暂时无法加载' : '正在加载高清图片' }}</small>
            <button
              v-if="isImageMediaFailed(previewImage)"
              type="button"
              class="image-media-state__retry"
              @click.stop="retryImageMedia(previewImage)"
            >
              重试
            </button>
          </div>
          <img
            v-if="!isImageMediaFailed(previewImage)"
            :key="imageMediaRenderKey(previewImage, 'preview')"
            :src="imageMediaDisplaySrc(previewImage, previewDisplaySrc)"
            :alt="previewImage.title"
            :class="{ 'opacity-0': !isImageMediaLoaded(previewImage) }"
            @load="markImageMediaLoaded(previewImage)"
            @error="handleImageMediaError(previewImage)"
          />
        </div>
        <section class="image-detail-dialog__panel">
          <div class="image-detail-dialog__section-head">
            <span>提示词</span>
            <button type="button" class="image-detail-dialog__copy" data-testid="copy-image-prompt" @click="copyPreviewPrompt">
              <Icon name="copy" size="xs" />
              <span>复制</span>
            </button>
          </div>
          <textarea
            v-model="previewPromptDraft"
            class="image-detail-dialog__prompt-input"
            data-testid="edit-image-prompt"
            rows="10"
            placeholder="修改提示词后重新生成..."
          />
          <dl class="image-detail-dialog__info">
            <div v-if="previewImage.size">
              <dt>尺寸</dt>
              <dd>{{ previewImage.size }}</dd>
            </div>
            <div v-if="previewImage.format">
              <dt>格式</dt>
              <dd>{{ previewImage.format.toUpperCase() }}</dd>
            </div>
            <div v-if="previewImage.model">
              <dt>模型</dt>
              <dd>{{ previewImage.model }}</dd>
            </div>
            <div>
              <dt>生成耗时</dt>
              <dd data-testid="image-generation-duration">{{ formatGenerationDuration(previewImage.durationMs) }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <template #footer>
        <div class="image-detail-dialog__footer">
          <span
            v-if="previewImage?.saved"
            class="image-detail-dialog__saved"
            data-testid="preview-saved-state"
          >
            <Icon name="checkCircle" size="sm" />
            <span>已保存到我的作品</span>
          </span>
          <button
            v-else-if="previewImage"
            type="button"
            class="image-detail-dialog__save"
            data-testid="save-preview-to-gallery"
            :disabled="savingPreviewImage"
            @click="savePreviewToGallery"
          >
            <Icon name="bookmark" size="sm" />
            <span>{{ savingPreviewImage ? '保存中' : '保存到我的作品' }}</span>
          </button>
          <button
            type="button"
            class="image-detail-dialog__regenerate"
            data-testid="regenerate-image-prompt"
            :disabled="!canRegeneratePreview"
            @click="regenerateFromPreview"
          >
            <Icon name="sparkles" size="sm" />
            <span>重新生成</span>
          </button>
          <button type="button" class="image-detail-dialog__download" @click="previewImage && downloadImage(previewImage)">
            <Icon name="download" size="sm" />
            <span>下载图片</span>
          </button>
        </div>
      </template>
    </BaseDialog>

    <ConfirmDialog
      :show="!!pendingDeleteImage"
      title="删除作品"
      message="删除后无法恢复，确定要继续吗？"
      confirm-text="确认删除"
      cancel-text="取消"
      :danger="true"
      @confirm="confirmRemoveGalleryImage"
      @cancel="pendingDeleteImage = null"
    />
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import StudioNav from '@/components/layout/StudioNav.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Toggle from '@/components/common/Toggle.vue'
import ImageStudioSelect from './ImageStudioSelect.vue'
import { IMAGE_STUDIO_DEFAULT_PROMPT, imageStudioDraft } from './imageStudioDraft'
import {
  imageNeedsLocalResize,
  LOCAL_IMAGE_MAX_EDGE,
  processImageForDisplay,
} from './imagePostProcess'
import { extractGeminiImageResults } from './geminiImageResults'
import Icon from '@/components/icons/Icon.vue'
import { useClipboard } from '@/composables/useClipboard'
import {
  createImageGenerationTaskId,
  ImageGenerationWaitCancelled,
  tryStartPersistentImageGeneration,
  waitForPersistentImageGeneration,
  type ImageGenerationWorkerResponse,
} from '@/utils/imageGenerationWorker'
import { usePromptResize } from '@/composables/usePromptResize'
import { ensureCreatorKey, isCreationServiceUnavailable } from '@/composables/useCreatorKey'
import { authAPI, imageStudioGalleryAPI, type ImageStudioGalleryEntry } from '@/api'
import type { ApiKey } from '@/types'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'

interface GeneratedImage {
  id: number | string
  title: string
  src: string
  originalSrc?: string
  thumbSrc?: string
  thumbSrcSet?: string
  meta: string
  prompt?: string
  model?: string
  size?: string
  format?: string
  quality?: string
  background?: string
  pending?: boolean
  taskId?: string
  batchId?: string
  gatewayTaskId?: string
  gatewayPollUrl?: string
  gatewaySubmitPending?: boolean
  apiKeyId?: number
  startedAt?: number
  durationMs?: number
  // 服务端状态：saved 为真表示已经存进「我的作品」（永久），
  // 否则是生成页的临时内容，expiresAt 是过期时间（秒）。
  saved?: boolean
  expiresAt?: number
  createdAt?: number
  restoredFromSnapshot?: boolean
}

type GenerationResultHandler = (
  image: GeneratedImage,
  result: PromiseSettledResult<any[]>,
) => Promise<void> | void

interface ReferenceItem {
  id: number
  name: string
  file: File
  preview: string
}

type SizeMode = 'auto' | 'ratio' | 'custom'

interface SizeSettings {
  mode: SizeMode
  aspectBase: number
  aspectRatio: string
  useCustomRatio: boolean
  customRatioWidth: number
  customRatioHeight: number
  width: number
  height: number
}

const keys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const apiBaseUrl = ref('')
const imageModel = ref('')
const imageModels = ref<string[]>([])
const loadingModels = ref(false)
const refreshing = ref(false)
const modelLoadError = ref('')
const prompt = ref(IMAGE_STUDIO_DEFAULT_PROMPT)
const promptTextareaRef = ref<HTMLTextAreaElement | null>(null)
const { height: promptHeight, startResize: startPromptResize } = usePromptResize(promptTextareaRef, {
  storageKey: 'sub2api:image-studio:prompt-height',
})
const appliedSize = reactive<SizeSettings>({
  mode: 'ratio',
  aspectBase: 1024,
  aspectRatio: '1:1',
  useCustomRatio: false,
  customRatioWidth: 16,
  customRatioHeight: 9,
  width: 1024,
  height: 1024,
})
const sizeMenuOpen = ref(false)
const customSizeOpen = ref(false)
const snapTo16 = ref(true)
const sizeFieldRef = ref<HTMLElement | null>(null)
const quality = ref('auto')
const format = ref('png')
const background = ref('auto')
const count = ref(1)
const sizeMenuPlacement = ref<'up' | 'down'>('down')
const generating = ref(false)
const activeGenerations = ref(0)
const errorMessage = ref('')
const images = ref<GeneratedImage[]>([])
const generationClockNow = ref(Date.now())
const activeImageTaskCount = computed(() => images.value.filter((image) => image.pending).length)
const keyCredentialsReady = ref(false)
const references = ref<ReferenceItem[]>([])
const previewImage = ref<GeneratedImage | null>(null)
const previewDisplaySrc = ref('')
const loadedImageMediaIds = ref<Set<string>>(new Set())
const failedImageMediaIds = ref<Set<string>>(new Set())
const imageMediaRetryNonce = ref<Map<string, number>>(new Map())
const pendingDeleteImage = ref<GeneratedImage | null>(null)
const deletingImage = ref(false)
const previewPromptDraft = ref('')
const savingPreviewImage = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const { copyToClipboard } = useClipboard()
const appStore = useAppStore()
const authStore = useAuthStore()

const draftOwnerId = String(authStore.user?.id || '')
if (imageStudioDraft.ownerId !== draftOwnerId) {
  imageStudioDraft.ownerId = draftOwnerId
  imageStudioDraft.initialized = false
  imageStudioDraft.prompt = IMAGE_STUDIO_DEFAULT_PROMPT
  imageStudioDraft.references = []
} else if (imageStudioDraft.initialized) {
  prompt.value = imageStudioDraft.prompt
  references.value = imageStudioDraft.references.map((item) => ({ ...item }))
}

const PENDING_STORAGE_KEY = 'sub2api:image-studio:pending'
const PENDING_PROMPT_STORAGE_KEY = 'sub2api:image-studio:pending-prompt'
const STUDIO_PREFERENCES_STORAGE_KEY = 'sub2api:image-studio:preferences'
const STUDIO_SNAPSHOT_STORAGE_KEY = 'sub2api:image-studio:snapshot-v1'
let nextImageId = 1

function pendingImageStorageKey(userId: number | string) {
  return `${PENDING_STORAGE_KEY}:${userId}`
}

interface ImageStudioPreferences {
  keyId: string
  model: string
}

function readStudioPreferences(): ImageStudioPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDIO_PREFERENCES_STORAGE_KEY) || '{}')
    return {
      keyId: typeof parsed?.keyId === 'string' ? parsed.keyId : '',
      model: typeof parsed?.model === 'string' ? parsed.model : '',
    }
  } catch {
    return { keyId: '', model: '' }
  }
}

function writeStudioPreferences(update: Partial<ImageStudioPreferences>) {
  try {
    const current = readStudioPreferences()
    localStorage.setItem(STUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify({
      ...current,
      ...update,
    }))
  } catch {
    // Persisting UI preferences is optional.
  }
}

interface ImageStudioSnapshot {
  keys: ApiKey[]
  selectedKeyId: string
  imageModels: string[]
  imageModel: string
  images: GeneratedImage[]
}

function studioSnapshotStorageKey(userId: number | string) {
  return `${STUDIO_SNAPSHOT_STORAGE_KEY}:${userId}`
}

function readStudioSnapshot(userId: number | string): ImageStudioSnapshot | null {
  try {
    // 旧版本共用同一个 key，清掉它可以避免跨账号泄露历史图片。
    sessionStorage.removeItem(STUDIO_SNAPSHOT_STORAGE_KEY)
    const parsed = JSON.parse(sessionStorage.getItem(studioSnapshotStorageKey(userId)) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      selectedKeyId: typeof parsed.selectedKeyId === 'string' ? parsed.selectedKeyId : '',
      imageModels: Array.isArray(parsed.imageModels) ? parsed.imageModels.filter((item: unknown) => typeof item === 'string') : [],
      imageModel: typeof parsed.imageModel === 'string' ? parsed.imageModel : '',
      images: Array.isArray(parsed.images) ? parsed.images : [],
    }
  } catch {
    return null
  }
}

function restoreStudioSnapshot(userId?: number | string) {
  if (userId == null) return
  const snapshot = readStudioSnapshot(userId)
  if (!snapshot) return
  keys.value = snapshot.keys.map((key) => ({ ...key, key: '' }))
  selectedKeyId.value = snapshot.selectedKeyId
  imageModels.value = snapshot.imageModels
  imageModel.value = snapshot.imageModel
  images.value = snapshot.images.map((image) => ({
    ...image,
    restoredFromSnapshot: true,
  }))
  const numericIds = images.value
    .map((image) => Number(image.id))
    .filter((id) => Number.isFinite(id) && id > 0)
  if (numericIds.length) {
    nextImageId = Math.max(nextImageId, ...numericIds.map((id) => id + 1))
  }
}

function writeStudioSnapshot() {
  try {
    const userId = authStore.user?.id
    if (userId == null) return
    const snapshot: ImageStudioSnapshot = {
      keys: keys.value.map((key) => ({ ...key, key: '' })),
      selectedKeyId: selectedKeyId.value,
      imageModels: imageModels.value,
      imageModel: imageModel.value,
      images: images.value
        .filter((image) => !image.pending && image.src && !image.src.startsWith('data:'))
        .slice(0, 48)
        .map((image) => ({
          ...image,
          originalSrc: undefined,
          thumbSrcSet: undefined,
        })),
    }
    sessionStorage.setItem(studioSnapshotStorageKey(userId), JSON.stringify(snapshot))
  } catch {
    // A cached UI snapshot is optional; failed writes must not affect the studio.
  }
}

restoreStudioSnapshot(authStore.user?.id)

const size = computed(() => formatSize(appliedSize))
// 上游按"总像素 + 比例"卡尺寸，本地不拦的话只能在生成时吃上游的 400。
const sizeIssue = computed(() => (
  isGeminiModel(imageModel.value) || (
    isGrokImageModelName(imageModel.value)
  )
    ? ''
    : validateSize(size.value)
))
const sizeDisplayLabel = computed(() => {
  if (appliedSize.mode === 'auto') return '自动（由模型决定）'
  if (appliedSize.mode === 'ratio' && isGrokImageModel.value) {
    return `${grokResolutionForBase(appliedSize.aspectBase)} · ${appliedSize.aspectRatio}`
  }
  if (appliedSize.mode === 'ratio') return `${appliedSize.aspectRatio} ${size.value}`
  const dimensions = parseSize(size.value)
  if (!dimensions) return size.value
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height)
  return `${dimensions.width / divisor}:${dimensions.height / divisor} ${size.value}`
})
const snapTo16Enabled = computed({
  get: () => snapTo16.value,
  set: (value: boolean) => {
    snapTo16.value = value
    if (!value) return
    appliedSize.width = normalizeDimension(appliedSize.width)
    appliedSize.height = normalizeDimension(appliedSize.height)
  },
})
const customSizeSummary = computed(() => {
  const dimensions = parseSize(size.value)
  if (!dimensions) return size.value
  const { width, height } = dimensions
  return `${width}×${height}，${width * height} 像素，比例 ${(width / height).toFixed(2)}:1。`
})
const geminiAspectBaseOptions = [
  { value: 1024, label: '1K' },
  { value: 2048, label: '2K' },
  { value: 3840, label: '4K' },
]
const gptAspectBaseOptions = [
  { value: 1024, label: '默认' },
  { value: 2048, label: '2K' },
  { value: 3840, label: '4K' },
]
const grokAspectBaseOptions = [
  { value: 1024, label: '1K' },
  { value: 2048, label: '2K' },
]
const genericAspectBaseOptions = [
  { value: 1024, label: '1K' },
  { value: 2048, label: '2K' },
  { value: 3840, label: '4K' },
]
const gptBaseDimensions: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '3:2': [1536, 1024],
  '2:3': [1024, 1536],
  '4:3': [1408, 1056],
  '3:4': [1056, 1408],
  '4:5': [1024, 1280],
  '5:4': [1280, 1024],
  '16:9': [1536, 864],
  '9:16': [864, 1536],
  '21:9': [1792, 768],
}
const geminiDefaultDimensions: Record<string, Record<string, [number, number]>> = {
  '1K': {
    '1:1': [1024, 1024],
    '2:3': [848, 1264],
    '3:2': [1264, 848],
    '3:4': [896, 1200],
    '4:3': [1200, 896],
    '4:5': [928, 1152],
    '5:4': [1152, 928],
    '9:16': [768, 1344],
    '16:9': [1344, 768],
    '21:9': [1536, 672],
  },
  '2K': {
    '1:1': [2048, 2048],
    '2:3': [1696, 2528],
    '3:2': [2528, 1696],
    '3:4': [1792, 2400],
    '4:3': [2400, 1792],
    '4:5': [1856, 2304],
    '5:4': [2304, 1856],
    '9:16': [1536, 2688],
    '16:9': [2688, 1536],
    '21:9': [3072, 1344],
  },
  '4K': {
    '1:1': [3840, 3840],
    '2:3': [2560, 3840],
    '3:2': [3840, 2560],
    '3:4': [2880, 3840],
    '4:3': [3840, 2880],
    '4:5': [3072, 3840],
    '5:4': [3840, 3072],
    '9:16': [2160, 3840],
    '16:9': [3840, 2160],
    '21:9': [3840, 1648],
  },
}
const allRatioOptions = [
  { value: '1:1', css: '1 / 1' },
  { value: '3:2', css: '3 / 2' },
  { value: '2:3', css: '2 / 3' },
  { value: '16:9', css: '16 / 9' },
  { value: '9:16', css: '9 / 16' },
  { value: '4:3', css: '4 / 3' },
  { value: '3:4', css: '3 / 4' },
  { value: '4:5', css: '4 / 5' },
  { value: '5:4', css: '5 / 4' },
  { value: '21:9', css: '21 / 9' },
]
const gptRatioOptions = allRatioOptions
const grokRatioOptions = [
  { value: '1:1', css: '1 / 1' },
  { value: '16:9', css: '16 / 9' },
  { value: '9:16', css: '9 / 16' },
  { value: '4:3', css: '4 / 3' },
  { value: '3:4', css: '3 / 4' },
  { value: '3:2', css: '3 / 2' },
  { value: '2:3', css: '2 / 3' },
  { value: '2:1', css: '2 / 1' },
  { value: '1:2', css: '1 / 2' },
  { value: '19.5:9', css: '19.5 / 9' },
  { value: '9:19.5', css: '9 / 19.5' },
  { value: '20:9', css: '20 / 9' },
  { value: '9:20', css: '9 / 20' },
]
const qualityOptions = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]
const formatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WEBP' },
]
const backgroundOptions = [
  { value: 'auto', label: '自动' },
  { value: 'transparent', label: '透明' },
  { value: 'opaque', label: '不透明' },
]
const transparentBackground = computed({
  get: () => background.value === 'transparent',
  set: (value: boolean) => {
    background.value = value ? 'transparent' : 'auto'
  },
})
const imageModelOptions = computed(() => imageModels.value.map((model) => ({ value: model, label: model })))
const modelSelectPlaceholder = computed(() => {
  if (loadingModels.value) return '正在加载...'
  return '选择模型'
})
const activeKeys = computed(() => keys.value.filter((key) => key.status === 'active'))
const imageCapableKeys = computed(() => activeKeys.value.filter(
  (key) => key.group?.allow_image_generation !== false,
))
const apiKeyOptions = computed(() => imageCapableKeys.value.map((key) => ({ value: String(key.id), label: key.name })))
const selectedKey = computed(() => imageCapableKeys.value.find((key) => String(key.id) === selectedKeyId.value) || null)
const canGenerate = computed(() => Boolean(apiBaseUrl.value && selectedKey.value?.key && imageModel.value.trim() && prompt.value.trim()) && !sizeIssue.value)
const isGeminiImageModel = computed(() => isGeminiModel(imageModel.value))
const isGptImageModel = computed(() => imageModel.value.toLowerCase().includes('gpt-image'))
const isGrokImageModel = computed(() => isGrokImageModelName(imageModel.value))
const maxImageEdge = computed(() => (
  isGeminiImageModel.value ? LOCAL_IMAGE_MAX_EDGE : IMAGE_MAX_EDGE
))
const modelSupportsTransparentBackground = computed(() => (
  !isGeminiImageModel.value && !isGrokImageModel.value
))
const qualityDisplayOptions = computed(() => isGeminiImageModel.value
  ? [
      qualityOptions[0],
      { value: 'high', label: '4K' },
      { value: 'medium', label: '2K' },
      { value: 'low', label: '1K' },
    ]
  : isGrokImageModel.value
    ? []
    : [
      qualityOptions[0],
      qualityOptions[3],
      qualityOptions[2],
      qualityOptions[1],
    ])
const aspectBaseOptions = computed(() => {
  if (isGeminiImageModel.value) return geminiAspectBaseOptions
  if (isGptImageModel.value) return gptAspectBaseOptions
  if (isGrokImageModel.value) return grokAspectBaseOptions
  return genericAspectBaseOptions
})
const ratioOptions = computed(() => {
  if (isGeminiImageModel.value) return allRatioOptions
  if (isGptImageModel.value) return gptRatioOptions
  if (isGrokImageModel.value) return grokRatioOptions
  return allRatioOptions
})
const canRegeneratePreview = computed(() => Boolean(
  previewImage.value &&
  previewPromptDraft.value.trim() &&
  selectedKey.value?.key &&
  !generating.value,
))
const hasReferences = computed(() => references.value.length > 0)

// 本会话里已保存进图库的条目 id：这些图本地已有可显示的副本，
// 图库列表里再渲染一次就会出现"生成一张却显示两张"的重复卡片。
const locallySavedGalleryIds = new Set<string>()
// 已经在服务端有记录的图片 id：只有这些能删（本地刚生成还没存进图库的删不了）。
const galleryBackedIds = ref<Set<string>>(new Set())
// 本会话刚保存进图库的图片，卡片上还是本地数字 id；映射到图库 id 才能立刻删掉，
// 不用等刷新页面。
const localToGalleryId = ref<Map<string, string>>(new Map())
const galleryThumbObjectUrls = new Map<string, string>()
const studioQuota = ref<{ used: number; limit: number } | null>(null)
const resumedGenerationBatches = new Set<string>()
const resumedGatewayBatches = new Set<string>()
let componentDisposed = false
let nextReferenceId = Math.max(1, ...references.value.map((item) => item.id + 1))
let modelRequestId = 0

function resolveEndpoint(configured: string) {
  return resolvePlaygroundApiEndpoint(configured, typeof window === 'undefined' ? '' : window.location.hostname)
}

function toggleSizeMenu(event?: MouseEvent) {
  if (sizeMenuOpen.value) {
    sizeMenuOpen.value = false
    return
  }

  const trigger = event?.currentTarget as HTMLElement | null
  if (trigger && typeof window !== 'undefined') {
    const rect = trigger.getBoundingClientRect()
    const menuHeight = Math.min(21 * 16, window.innerHeight * 0.52)
    const spaceAbove = rect.top - 8
    const spaceBelow = window.innerHeight - rect.bottom - 8
    sizeMenuPlacement.value = spaceAbove >= menuHeight
      ? 'up'
      : spaceBelow >= menuHeight
        ? 'down'
        : spaceAbove > spaceBelow
          ? 'up'
          : 'down'
  }
  sizeMenuOpen.value = true
}

function handleSizeOutside(event: MouseEvent) {
  if (!sizeMenuOpen.value) return
  if (sizeFieldRef.value?.contains(event.target as Node)) return
  sizeMenuOpen.value = false
}

function handleSizeEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') sizeMenuOpen.value = false
}

function toggleCustomSize() {
  customSizeOpen.value = !customSizeOpen.value
  sizeMenuOpen.value = false
  if (!customSizeOpen.value) return
  const dimensions = parseSize(size.value)
  appliedSize.mode = 'custom'
  appliedSize.width = dimensions?.width ?? appliedSize.aspectBase
  appliedSize.height = dimensions?.height ?? appliedSize.aspectBase
}

function applyAutoSize() {
  appliedSize.mode = 'auto'
  quality.value = 'auto'
  sizeMenuOpen.value = false
  customSizeOpen.value = false
}

function applyRatioPreset(base: number, ratio: string) {
  appliedSize.mode = 'ratio'
  appliedSize.aspectBase = base
  appliedSize.aspectRatio = ratio
  appliedSize.useCustomRatio = false
  if (isGeminiImageModel.value) {
    quality.value = qualityForAspectBase(base)
  }
  sizeMenuOpen.value = false
  customSizeOpen.value = false
}

function selectQuality(value: string) {
  quality.value = value
  if (!isGeminiImageModel.value) return
  if (value === 'high') appliedSize.aspectBase = 3840
  else if (value === 'medium') appliedSize.aspectBase = 2048
  else if (value === 'low') appliedSize.aspectBase = 1024
}

function resetParametersForModel(model: string) {
  if (!model) return
  sizeMenuOpen.value = false
  customSizeOpen.value = false
  appliedSize.mode = 'ratio'
  appliedSize.useCustomRatio = false

  if (isGeminiModel(model)) {
    background.value = 'auto'
    const tier = geminiTierForQuality(quality.value) || '1K'
    appliedSize.aspectBase = tier === '4K' ? 3840 : tier === '2K' ? 2048 : 1024
    if (!geminiDefaultDimensions[tier]?.[appliedSize.aspectRatio]) {
      appliedSize.aspectRatio = '1:1'
    }
    return
  }

  if (model.toLowerCase().includes('gpt-image')) {
    appliedSize.aspectBase = 1024
    if (!gptBaseDimensions[appliedSize.aspectRatio]) {
      appliedSize.aspectRatio = '1:1'
    }
    return
  }

  if (isGrokImageModelName(model)) {
    background.value = 'auto'
    quality.value = 'auto'
    if (!grokAspectBaseOptions.some((option) => option.value === appliedSize.aspectBase)) {
      appliedSize.aspectBase = 1024
    }
    if (!grokRatioOptions.some((option) => option.value === appliedSize.aspectRatio)) {
      appliedSize.aspectRatio = '1:1'
    }
    return
  }

  if (!genericAspectBaseOptions.some((option) => option.value === appliedSize.aspectBase)) {
    appliedSize.aspectBase = 1024
  }
  if (!allRatioOptions.some((option) => option.value === appliedSize.aspectRatio)) {
    appliedSize.aspectRatio = '1:1'
  }
}

function qualityForAspectBase(base: number) {
  if (base >= 3840) return 'high'
  if (base >= 2048) return 'medium'
  return 'low'
}

function grokResolutionForBase(base: number) {
  return base >= 2048 ? '2K' : '1K'
}

function geminiTierForQuality(value: string) {
  if (value === 'high') return '4K'
  if (value === 'medium') return '2K'
  if (value === 'low') return '1K'
  return ''
}

function geminiTierForAspectBase(base: number) {
  return geminiTierForQuality(qualityForAspectBase(base))
}

function geminiDimensions(ratio: string, tier: string) {
  return geminiDefaultDimensions[tier]?.[ratio]
}

function gptDimensions(ratio: string, base: number): [number, number] | undefined {
  const dimensions = gptBaseDimensions[ratio]
  if (!dimensions) return undefined
  const scale = base >= 3840 ? 4 : base >= 2048 ? 2 : 1
  const fitted = fitSizeToWindow(dimensions[0] * scale, dimensions[1] * scale)
  return [fitted.width, fitted.height]
}

function displayRatioSize(ratio: string, base: number) {
  if (isGeminiImageModel.value) {
    const dimensions = geminiDimensions(ratio, geminiTierForAspectBase(base))
    if (dimensions) return `${dimensions[0]}x${dimensions[1]}`
  }
  if (isGptImageModel.value) {
    const dimensions = gptDimensions(ratio, base)
    if (dimensions) return `${dimensions[0]}x${dimensions[1]}`
  }
  if (isGrokImageModel.value) {
    return `${grokResolutionForBase(base)} · ${ratio}`
  }
  return ratioSize(ratio, base)
}

function sizeOptionLabel(ratio: string, base: number) {
  if (isGrokImageModel.value) return displayRatioSize(ratio, base)
  return `${ratio} ${displayRatioSize(ratio, base)}`
}

function isRatioSelected(base: number, ratio: string) {
  return (
    appliedSize.mode === 'ratio' &&
    !appliedSize.useCustomRatio &&
    appliedSize.aspectBase === base &&
    appliedSize.aspectRatio === ratio
  )
}

function ratioShapeStyle(value: string) {
  const [width, height] = value.split(':').map(Number)
  const max = 1.15
  if (!width || !height) return { width: `${max}rem`, height: `${max}rem` }
  return width >= height
    ? { width: `${max}rem`, height: `${max * height / width}rem` }
    : { width: `${max * width / height}rem`, height: `${max}rem` }
}

function normalizeCount() {
  count.value = Math.min(4, Math.max(1, Math.round(Number(count.value) || 1)))
}

// 上游（gpt-image 系列）对 size 的约束：边长 16 的倍数、最长边 256~3840、
// 长短边比 ≤ 3:1、总像素 655360 ~ 8294400（上限正好是 3840x2160）。
// 只按"最长边 ≤ 3840"约束的话，4K 的方形/3:2/4:3 都能选出来，但会被上游拒绝。
const IMAGE_MIN_EDGE = 256
const IMAGE_MAX_EDGE = 3840
const IMAGE_MIN_PIXELS = 655_360
const IMAGE_MAX_PIXELS = 8_294_400

function formatSize(settings: SizeSettings) {
  if (settings.mode === 'auto') return 'auto'
  if (isGeminiImageModel.value && settings.mode === 'ratio') {
    const ratio = settings.useCustomRatio
      ? `${settings.customRatioWidth}:${settings.customRatioHeight}`
      : settings.aspectRatio
    const tier = geminiTierForQuality(quality.value) || geminiTierForAspectBase(settings.aspectBase)
    const dimensions = geminiDimensions(ratio, tier)
    if (dimensions) return `${dimensions[0]}x${dimensions[1]}`
  }
  if (isGptImageModel.value && settings.mode === 'ratio' && !settings.useCustomRatio) {
    const dimensions = gptDimensions(settings.aspectRatio, settings.aspectBase)
    if (dimensions) return `${dimensions[0]}x${dimensions[1]}`
  }
  if (isGrokImageModel.value && settings.mode === 'ratio' && !settings.useCustomRatio) {
    return ratioSize(settings.aspectRatio, settings.aspectBase)
  }
  if (settings.mode === 'custom') {
    const formatDimension = snapTo16.value ? normalizeDimension : clampDimension
    return `${formatDimension(settings.width)}x${formatDimension(settings.height)}`
  }
  if (settings.useCustomRatio) {
    return ratioSize(`${settings.customRatioWidth}:${settings.customRatioHeight}`, settings.aspectBase)
  }
  return ratioSize(settings.aspectRatio, settings.aspectBase)
}

function ratioSize(ratio: string, base: number) {
  const [rawWidth, rawHeight] = ratio.split(':').map(Number)
  if (!rawWidth || !rawHeight) return formatDimensions(base, base)
  const width = rawWidth >= rawHeight ? base : base * rawWidth / rawHeight
  const height = rawWidth >= rawHeight ? base * rawHeight / rawWidth : base
  const fitted = fitSizeToWindow(width, height)
  return `${fitted.width}x${fitted.height}`
}

/**
 * 把一组宽高收敛到上游允许的窗口内：保持比例，超上限按比例缩小，
 * 低于下限按比例放大（不越最长边）。预设尺寸走这里，于是 4K+1:1 会
 * 得到 2880x2880，而不是会被拒绝的 3840x3840。
 */
function fitSizeToWindow(rawWidth: number, rawHeight: number) {
  const safeWidth = Math.max(IMAGE_MIN_EDGE, Number(rawWidth) || IMAGE_MIN_EDGE)
  const safeHeight = Math.max(IMAGE_MIN_EDGE, Number(rawHeight) || IMAGE_MIN_EDGE)
  const edgeFactor = Math.min(1, IMAGE_MAX_EDGE / Math.max(safeWidth, safeHeight))
  let width = normalizeDimension(safeWidth * edgeFactor)
  let height = normalizeDimension(safeHeight * edgeFactor)

  for (let guard = 0; guard < 128 && width * height > IMAGE_MAX_PIXELS; guard += 1) {
    const factor = Math.sqrt(IMAGE_MAX_PIXELS / (width * height))
    const nextWidth = Math.max(IMAGE_MIN_EDGE, Math.floor(width * factor / 16) * 16)
    const nextHeight = Math.max(IMAGE_MIN_EDGE, Math.floor(height * factor / 16) * 16)
    if (nextWidth === width && nextHeight === height) break
    width = nextWidth
    height = nextHeight
  }

  for (let guard = 0; guard < 128 && width * height < IMAGE_MIN_PIXELS; guard += 1) {
    const edgeRoom = Math.max(1, IMAGE_MAX_EDGE / Math.max(width, height))
    const factor = Math.min(Math.sqrt(IMAGE_MIN_PIXELS / (width * height)), edgeRoom)
    const nextWidth = Math.min(IMAGE_MAX_EDGE, Math.ceil(width * factor / 16) * 16)
    const nextHeight = Math.min(IMAGE_MAX_EDGE, Math.ceil(height * factor / 16) * 16)
    if (nextWidth === width && nextHeight === height) break
    width = nextWidth
    height = nextHeight
  }

  return { width, height }
}

function formatDimensions(width: number, height: number) {
  return `${normalizeDimension(width)}x${normalizeDimension(height)}`
}

/** 校验最终 size 是否满足上游约束：通过返回空串，否则返回给用户看的原因。 */
function validateSize(value: string) {
  if (!value || value === 'auto') return ''
  const parsed = parseSize(value)
  if (!parsed) return '尺寸格式无法识别'
  const { width, height } = parsed
  const longest = Math.max(width, height)
  const shortest = Math.min(width, height)
  if (shortest < IMAGE_MIN_EDGE || longest > IMAGE_MAX_EDGE) {
    return `边长需在 ${IMAGE_MIN_EDGE}~${IMAGE_MAX_EDGE} 之间`
  }
  if (width % 16 !== 0 || height % 16 !== 0) return '边长必须是 16 的倍数'
  if (longest / shortest > 3) return '长短边比不能超过 3:1'
  const pixels = width * height
  if (pixels < IMAGE_MIN_PIXELS) return `总像素 ${pixels} 低于下限 ${IMAGE_MIN_PIXELS}`
  if (pixels > IMAGE_MAX_PIXELS) {
    return `总像素 ${pixels} 超过上限 ${IMAGE_MAX_PIXELS}（3840x2160）`
  }
  return ''
}

function normalizeDimension(value: number) {
  return Math.round(clampDimension(value) / 16) * 16
}

function clampDimension(value: number) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 1024
  return Math.round(Math.min(maxImageEdge.value, Math.max(IMAGE_MIN_EDGE, numeric)))
}

function parseSize(value: string) {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

async function loadKeysAndSettings() {
  const keysPromise = ensureCreatorKey('image')
    .then((result) => {
      keys.value = result.keys
      const preferences = readStudioPreferences()
      const preferredKey = result.keys.find((key) => (
        String(key.id) === preferences.keyId
        && key.status === 'active'
        && key.group?.allow_image_generation !== false
      ))
      selectedKeyId.value = String(preferredKey?.id ?? result.key.id)
      keyCredentialsReady.value = true
    })
    .catch((error) => {
      keyCredentialsReady.value = true
      if (!isCreationServiceUnavailable(error)) {
        errorMessage.value = errorMessageFrom(error, '图片创作服务暂不可用')
      }
    })
  const settingsPromise = authAPI.getPublicSettings()
    .then((settings) => {
      apiBaseUrl.value = resolveEndpoint(settings.api_base_url || '')
    })
    .catch((error) => {
      if (!errorMessage.value) errorMessage.value = errorMessageFrom(error, '加载设置失败')
    })

  await Promise.allSettled([keysPromise, settingsPromise])
}

async function loadData() {
  errorMessage.value = ''
  restorePendingImages()
  await Promise.allSettled([loadKeysAndSettings(), loadGallery(), loadStudioQuota()])
  void resumeGatewayGeneration(images.value.filter((item) => item.pending && item.gatewayPollUrl))
}

async function loadGallery() {
  try {
    const entries = await imageStudioGalleryAPI.list()
    for (const entry of entries) {
      if (entry?.id) galleryBackedIds.value.add(String(entry.id))
      const localImage = images.value.find((item) => (
        localToGalleryId.value.get(String(item.id)) === String(entry?.id || '')
      ))
      if (localImage) {
        const storedURL = String(entry.url || '')
        if (storedURL && !sameStoredObject(localImage.src, storedURL)) {
          localImage.src = storedURL
          resetImageMediaState(localImage)
        }
        const storedThumbURL = String(entry.thumb_url || '')
        if (storedThumbURL && !sameStoredObject(localImage.thumbSrc, storedThumbURL)) {
          localImage.thumbSrc = storedThumbURL
          resetImageMediaState(localImage)
        }
        localImage.saved = entry.saved !== false
        localImage.expiresAt = entry.expires_at || 0
      }
    }
    const pending = images.value.filter((item) => item.pending)
    const localResults = images.value.filter((item) => (
      !item.pending
      && !item.restoredFromSnapshot
      && typeof item.id === 'number'
    ))
    const seen = new Set<string>()
    const existingById = new Map(images.value.map((item) => [String(item.id), item]))
    const gallery = entries
      // 本会话刚保存进图库的图片，本地已经有一份可显示的数据副本；
      // 再从图库列表渲染一份就会变成"生成一个却显示两个"。
      .filter((entry) => !locallySavedGalleryIds.has(String(entry.id)))
      .map((entry, index) => {
        const existing = existingById.get(String(entry.id))
        if (!existing) return galleryEntryToImage(entry, index)
        return {
          ...existing,
          src: sameStoredObject(existing.src, entry.url) ? existing.src : entry.url,
          thumbSrc: sameStoredObject(existing.thumbSrc, entry.thumb_url)
            ? existing.thumbSrc
            : entry.thumb_url || existing.thumbSrc,
          prompt: entry.prompt,
          model: entry.model,
          size: entry.size,
          format: entry.format,
          saved: entry.saved !== false,
          expiresAt: entry.expires_at || 0,
          durationMs: Number(entry.duration_ms || 0) || undefined,
          createdAt: entry.created_at || 0,
        }
      })
      .filter((item) => {
        const key = String(item.id || item.src)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    const merged = [...localResults, ...gallery].filter((item, index, all) => {
      const key = String(item.id || item.src)
      return all.findIndex((candidate) => String(candidate.id || candidate.src) === key) === index
    })
    images.value = [...pending, ...merged]
    for (const entry of entries) {
      if (!entry.thumb_url && !galleryThumbObjectUrls.has(entry.id)) void loadGalleryThumbnail(entry.id)
    }
  } catch {
    // Gallery storage is optional; generation remains available without it.
  }
}

function sameStoredObject(current: string | undefined, next: string | undefined) {
  if (!current || !next) return false
  try {
    const currentURL = new URL(current, window.location.origin)
    const nextURL = new URL(next, window.location.origin)
    return currentURL.origin === nextURL.origin && currentURL.pathname === nextURL.pathname
  } catch {
    return current === next
  }
}

async function loadGalleryThumbnail(id: string) {
  try {
    const blob = await imageStudioGalleryAPI.thumbnail(id)
    const url = URL.createObjectURL(blob)
    const previous = galleryThumbObjectUrls.get(id)
    if (previous) URL.revokeObjectURL(previous)
    galleryThumbObjectUrls.set(id, url)
    const image = images.value.find((item) => (
      String(item.id) === id
      || localToGalleryId.value.get(String(item.id)) === id
    ))
    if (image) {
      image.thumbSrcSet = url
      resetImageMediaState(image)
    }
  } catch {
    // Keep the stored thumbnail or original URL as the fallback.
  }
}

function galleryEntryToImage(entry: ImageStudioGalleryEntry, index: number): GeneratedImage {
  return {
    id: entry.id,
    title: `历史图片 ${index + 1}`,
    src: entry.url,
    thumbSrc: entry.thumb_url || '',
    prompt: entry.prompt,
    model: entry.model,
    size: entry.size,
    format: entry.format,
    meta: [
      entry.format?.toUpperCase(),
      entry.size,
      entry.model,
    ].filter(Boolean).join(' · '),
    saved: entry.saved !== false,
    expiresAt: entry.expires_at || 0,
    durationMs: Number(entry.duration_ms || 0) || undefined,
    createdAt: entry.created_at || 0,
  }
}

function formatCreatedAt(timestamp?: number): string {
  if (!timestamp) return '—'
  const date = new Date(Number(timestamp) * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function restorePendingImages() {
  try {
    const userId = authStore.user?.id
    if (userId == null) return
    // 旧版本所有账号共用同一个 key，不能让下一位登录用户恢复它。
    localStorage.removeItem(PENDING_STORAGE_KEY)
    const stored = JSON.parse(localStorage.getItem(pendingImageStorageKey(userId)) || '[]')
    if (!Array.isArray(stored)) return
    const restoredAll = stored
      .filter((item): item is GeneratedImage => (
        item
        && item.pending
        && Number.isFinite(Number(item.id))
        && typeof item.taskId === 'string'
        && item.taskId.length > 0
      ))
      .map((item) => ({
        ...item,
        title: '正在生成',
        src: '',
        pending: true,
        startedAt: Number(item.startedAt) > 0 ? Number(item.startedAt) : Date.now(),
      }))
    const ambiguousGatewaySubmissions = restoredAll.filter((item) => (
      item.gatewaySubmitPending && !item.gatewayPollUrl
    ))
    const restored = restoredAll.filter((item) => !ambiguousGatewaySubmissions.includes(item))
    if (ambiguousGatewaySubmissions.length) {
      appStore.showWarning('有图片任务的提交结果无法确认，为避免重复扣费未自动重试。请确认作品库后重新生成。', 6000)
    }
    if (!restored.length) {
      localStorage.removeItem(pendingImageStorageKey(userId))
      return
    }
    nextImageId = Math.max(nextImageId, ...restored.map((item) => Number(item.id) + 1))
    images.value = [
      ...restored,
      ...images.value.filter((item) => !item.pending),
    ]
    persistPendingImages()
    const serviceWorkerPending = restored.filter((item) => !item.gatewayPollUrl)
    if (serviceWorkerPending.length && 'serviceWorker' in navigator && typeof indexedDB !== 'undefined') {
      appStore.showSuccess(`已恢复 ${restored.length} 个后台生成任务`, 3000)
      void resumePersistentGeneration(serviceWorkerPending)
    }
  } catch {
    // Ignore malformed browser storage and continue with an empty gallery.
  }
}

function applyInspirationFromRoute() {
  try {
    const pending = sessionStorage.getItem(PENDING_PROMPT_STORAGE_KEY)
    if (pending && pending.trim()) {
      prompt.value = pending.trim()
      appStore.showSuccess('已带入图片灵感提示词，选好模型和尺寸就可以生成。', 3000)
      sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY)
    }
  } catch {
    // 浏览器存储不可用时按没有待带入提示词处理。
  }
}

function persistPendingImages() {
  try {
    const userId = authStore.user?.id
    if (userId == null) return
    const pending = images.value.filter((item) => item.pending)
    if (pending.length) localStorage.setItem(pendingImageStorageKey(userId), JSON.stringify(pending))
    else localStorage.removeItem(pendingImageStorageKey(userId))
  } catch {
    // Browser storage is optional.
  }
}

async function resumePersistentGeneration(pendingImages: GeneratedImage[]) {
  const batches = new Map<string, GeneratedImage[]>()
  for (const image of pendingImages) {
    if (!image.taskId) continue
    const batchId = image.batchId || image.taskId
    if (resumedGenerationBatches.has(batchId)) continue
    const batch = batches.get(batchId) || []
    batch.push(image)
    batches.set(batchId, batch)
  }

  for (const [batchId, batch] of batches) {
    resumedGenerationBatches.add(batchId)
    activeGenerations.value += 1
    generating.value = true
    const progress = createGenerationProgress()
    try {
      const imagesByTaskId = new Map(
        batch.map((image) => [String(image.taskId), image]),
      )
      const responses = await waitForPersistentImageGeneration(
        batch.map((image) => image.taskId!).filter(Boolean),
        {
          isCancelled: () => componentDisposed,
          onResponse: async (id, response) => {
            const image = imagesByTaskId.get(id)
            if (!image) return
            await progress.enqueue(image, workerResponseToSettledResult(response))
          },
        },
      )
      for (let index = 0; index < responses.length; index += 1) {
        const image = batch[index]
        if (!image) continue
        await progress.enqueue(image, workerResponseToSettledResult(responses[index]))
      }
      await progress.drain()
      removePendingImages(batch.filter((image) => !progress.completedIds.has(image.id)))
      if (progress.generatedCount === 0) {
        throw progress.firstError || new Error('上游没有返回图片')
      }
      if (progress.firstError) {
        errorMessage.value = errorMessageFrom(progress.firstError, '部分图片生成失败')
      }
    } catch (error) {
      if (error instanceof ImageGenerationWaitCancelled) return
      removePendingImages(batch)
      errorMessage.value = errorMessageFrom(error, '恢复图片生成任务失败')
    } finally {
      resumedGenerationBatches.delete(batchId)
      activeGenerations.value = Math.max(0, activeGenerations.value - 1)
      generating.value = activeGenerations.value > 0
    }
  }
}

async function persistGeneratedImages(
  items: GeneratedImage[],
  prompt: string,
  model: string,
  options: { refresh?: boolean } = {},
) {
  const results = await Promise.allSettled(items.map(async (item) => {
    // data: 前缀直接上传；http(s) 交给服务端下载转存，
    // 避免浏览器抓上游图片时被 CORS 拦掉导致保存失败。
    const source = item.src.startsWith('data:')
      ? { image_data_url: item.src }
      : { image_url: item.src }
    const entry = await imageStudioGalleryAPI.save({
      ...source,
      prompt,
      model,
      size: item.size || size.value,
      format: item.format || format.value,
      duration_ms: item.durationMs || undefined,
      created_at: item.createdAt || undefined,
      // 生成页的内容先进临时档（到期自动删）；用户点「存到我的作品」才转永久。
      saved: false,
    })
    return { item, entry }
  }))
  const succeeded = results.filter((result) => result.status === 'fulfilled').length
  const failed = results.length - succeeded
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value?.entry?.id) {
      locallySavedGalleryIds.add(String(result.value.entry.id))
      galleryBackedIds.value.add(String(result.value.entry.id))
      localToGalleryId.value.set(String(result.value.item.id), String(result.value.entry.id))
      // 记住服务端状态，卡片上才能显示"还剩 N 天 / 已保存"。
      result.value.item.saved = result.value.entry.saved !== false
      result.value.item.expiresAt = result.value.entry.expires_at || 0
      const storedURL = String(result.value.entry.url || '')
      if (storedURL && storedURL !== result.value.item.src) {
        result.value.item.src = storedURL
        resetImageMediaState(result.value.item)
      }
      const storedThumbURL = String(result.value.entry.thumb_url || '')
      if (storedThumbURL) {
        result.value.item.thumbSrc = storedThumbURL
        resetImageMediaState(result.value.item)
      }
    }
  }
  if (succeeded > 0 && options.refresh !== false) {
    await loadGallery()
    await loadStudioQuota()
  }
  if (failed > 0) {
    const failedResult = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    const detail = errorMessageFrom(
      failedResult?.reason,
      '请检查对象存储是否已启用并保存配置。',
    )
    if (isImageStorageConfigError(failedResult?.reason) && !authStore.isAdmin) {
      return false
    }
    errorMessage.value = quotaReached(results)
      ? `作品已达上限（${studioQuota.value?.limit || 100} 个），请先在下方删除一些作品再保存。`
      : succeeded > 0
        ? `部分图片未能保存到图库：${detail}`
        : `图片已生成，但保存到图库失败：${detail}`
  }
  return succeeded > 0
}

// 配额满了后端返回 429 + *_QUOTA_EXCEEDED，单独给一句能指导操作的提示。
function isQuotaError(error: unknown): boolean {
  const reason = typeof error === 'object' && error !== null && 'reason' in error
    ? String((error as { reason?: unknown }).reason || '')
    : ''
  return reason.endsWith('_QUOTA_EXCEEDED')
}

function quotaReached(results: Array<{ status: string; reason?: unknown }>): boolean {
  return results.some((result) => isQuotaError({ reason: result.reason }))
}

// 临时内容的剩余天数：向上取整，最少显示 1 天。
function remainingDays(image: GeneratedImage): number {
  const expiresAt = Number(image.expiresAt || 0)
  if (!expiresAt) return 0
  return Math.max(1, Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000))
}

function pendingElapsedSeconds(image: GeneratedImage): number {
  const startedAt = Number(image.startedAt || 0)
  if (!startedAt) return 0
  return Math.max(0, Math.floor((generationClockNow.value - startedAt) / 1000))
}

function formatGenerationDuration(durationMs?: number): string {
  const duration = Number(durationMs || 0)
  if (!Number.isFinite(duration) || duration <= 0) return '未记录'
  const totalSeconds = Math.floor(duration / 1000)
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  return `${Math.floor(totalSeconds / 60)} 分 ${totalSeconds % 60} 秒`
}

function imageMediaId(image: GeneratedImage) {
  return String(image.id)
}

function imageMediaRenderKey(image: GeneratedImage, scope = 'card') {
  return `${scope}-${imageMediaId(image)}-${imageMediaRetryNonce.value.get(imageMediaId(image)) || 0}`
}

function imageMediaDisplaySrc(image: GeneratedImage, preferred?: string) {
  const source = preferred || image.thumbSrc || image.src
  const nonce = imageMediaRetryNonce.value.get(imageMediaId(image)) || 0
  if (!nonce || !/^https?:\/\//i.test(source)) return source
  try {
    const url = new URL(source, window.location.origin)
    url.searchParams.set('_retry', String(nonce))
    return url.toString()
  } catch {
    return source
  }
}

function isImageMediaLoaded(image: GeneratedImage) {
  return loadedImageMediaIds.value.has(imageMediaId(image))
}

function isImageMediaFailed(image: GeneratedImage) {
  return failedImageMediaIds.value.has(imageMediaId(image))
}

function markImageMediaLoaded(image: GeneratedImage) {
  const id = imageMediaId(image)
  failedImageMediaIds.value.delete(id)
  loadedImageMediaIds.value.add(id)
}

function markImageMediaFailed(image: GeneratedImage) {
  const id = imageMediaId(image)
  loadedImageMediaIds.value.delete(id)
  failedImageMediaIds.value.add(id)
}

function handleImageMediaError(image: GeneratedImage) {
  if (previewImage.value?.id === image.id) {
    previewDisplaySrc.value = image.src
  }
  if (image.thumbSrcSet) {
    image.thumbSrcSet = ''
    resetImageMediaState(image)
    return
  }
  if (image.thumbSrc && image.thumbSrc !== image.src) {
    image.thumbSrc = ''
    resetImageMediaState(image)
    return
  }
  markImageMediaFailed(image)
}

function resetImageMediaState(image: GeneratedImage, bumpRetry = false) {
  const id = imageMediaId(image)
  loadedImageMediaIds.value.delete(id)
  failedImageMediaIds.value.delete(id)
  if (bumpRetry) {
    imageMediaRetryNonce.value.set(id, (imageMediaRetryNonce.value.get(id) || 0) + 1)
  }
}

function retryImageMedia(image: GeneratedImage) {
  resetImageMediaState(image, true)
  if (previewImage.value?.id === image.id) {
    void loadPreviewDisplay(image)
  }
}

let previewLoadToken = 0

async function loadPreviewDisplay(image: GeneratedImage) {
  const token = ++previewLoadToken
  const thumbnail = image.thumbSrc || image.thumbSrcSet || image.src
  previewDisplaySrc.value = thumbnail
  if (!thumbnail || thumbnail === image.src || typeof Image === 'undefined') return

  const loader = new Image()
  loader.decoding = 'async'
  loader.src = image.src
  try {
    if (typeof loader.decode === 'function') {
      await loader.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        loader.onload = () => resolve()
        loader.onerror = () => reject(new Error('preview image failed to load'))
      })
    }
  } catch {
    return
  }
  if (token === previewLoadToken && previewImage.value?.id === image.id) {
    previewDisplaySrc.value = image.src
  }
}

let generationClockTimer: ReturnType<typeof setInterval> | null = null

function startGenerationClock() {
  generationClockNow.value = Date.now()
  if (generationClockTimer) return
  generationClockTimer = setInterval(() => {
    generationClockNow.value = Date.now()
  }, 1000)
}

function stopGenerationClock() {
  if (!generationClockTimer) return
  clearInterval(generationClockTimer)
  generationClockTimer = null
}

// 把临时内容存进「我的作品」：之后永久保留，并开始计入配额。
async function pinImage(image: GeneratedImage) {
  const id = galleryIdFor(image)
  if (!id || !galleryBackedIds.value.has(id)) return
  errorMessage.value = ''
  try {
    await imageStudioGalleryAPI.pin(id)
    image.saved = true
    image.expiresAt = 0
    await loadStudioQuota()
  } catch (error) {
    errorMessage.value = isQuotaError(error)
      ? `我的作品已满（${studioQuota.value?.limit || 100} 个），先删除一些再保存。`
      : errorMessageFrom(error, '保存到我的作品失败')
  }
}

async function savePreviewToGallery() {
  const image = previewImage.value
  if (!image || image.saved || savingPreviewImage.value) return
  savingPreviewImage.value = true
  errorMessage.value = ''
  try {
    const id = galleryIdFor(image)
    if (id && galleryBackedIds.value.has(id)) {
      await imageStudioGalleryAPI.pin(id)
      image.saved = true
      image.expiresAt = 0
      await loadStudioQuota()
      return
    }

    const promptText = previewPromptDraft.value.trim() || image.prompt || ''
    const source = image.src.startsWith('data:')
      ? { image_data_url: image.src }
      : { image_url: image.src }
    const entry = await imageStudioGalleryAPI.save({
      ...source,
      prompt: promptText,
      model: image.model || imageModel.value,
      size: image.size || size.value,
      format: image.format || format.value,
      saved: true,
    })
    locallySavedGalleryIds.add(String(entry.id))
    galleryBackedIds.value.add(String(entry.id))
    localToGalleryId.value.set(String(image.id), String(entry.id))
    image.saved = entry.saved !== false
    image.expiresAt = entry.expires_at || 0
    image.prompt = promptText
    if (entry.url) image.src = entry.url
    image.thumbSrc = entry.thumb_url || ''
    await loadGallery()
    await loadStudioQuota()
  } catch (error) {
    errorMessage.value = isQuotaError(error)
      ? `我的作品已满（${studioQuota.value?.limit || 100} 个），先删除一些再保存。`
      : errorMessageFrom(error, '保存到我的作品失败')
  } finally {
    savingPreviewImage.value = false
  }
}

async function loadStudioQuota() {
  try {
    studioQuota.value = await imageStudioGalleryAPI.quota()
  } catch {
    // 配额展示是锦上添花，读不到就不显示。
  }
}

// 删除作品：后端先删对象存储里的文件、再删记录，成功后本地也把它移掉。
// 刚保存进图库的图片卡片上还是本地 id，所以要先用映射换成服务端的作品 id。
function galleryIdFor(image: GeneratedImage): string {
  const local = String(image.id)
  return localToGalleryId.value.get(local) || local
}

function removeGalleryImage(image: GeneratedImage) {
  const id = galleryIdFor(image)
  if (!id || !galleryBackedIds.value.has(id)) return
  pendingDeleteImage.value = image
}

async function confirmRemoveGalleryImage() {
  const image = pendingDeleteImage.value
  pendingDeleteImage.value = null
  if (!image || deletingImage.value) return
  deletingImage.value = true
  errorMessage.value = ''
  try {
    const id = galleryIdFor(image)
    await imageStudioGalleryAPI.delete(id)
    galleryBackedIds.value.delete(id)
    locallySavedGalleryIds.delete(id)
    localToGalleryId.value.delete(String(image.id))
    images.value = images.value.filter((item) => String(item.id) !== String(image.id))
    await loadStudioQuota()
  } catch (error) {
    errorMessage.value = errorMessageFrom(error, '删除失败')
  } finally {
    deletingImage.value = false
  }
}

function imageFormatFromSource(src: string, fallback: string): string {
  const match = /^data:image\/([^;,]+)/i.exec(src)
  const mime = match?.[1]?.toLowerCase().replace('jpg', 'jpeg')
  return mime && formatOptions.some((option) => option.value === mime) ? mime : fallback
}

function imageFormatFromResult(item: any, src: string, fallback: string): string {
  const mime = String(item?.mimeType || item?.mime_type || '')
    .trim()
    .toLowerCase()
    .replace('image/jpg', 'image/jpeg')
  const format = mime.startsWith('image/') ? mime.slice('image/'.length) : ''
  return format && formatOptions.some((option) => option.value === format)
    ? format
    : imageFormatFromSource(src, fallback)
}

async function loadModels() {
  const requestId = ++modelRequestId
  const preferredModel = readStudioPreferences().model
  loadingModels.value = true
  imageModels.value = []
  imageModel.value = ''
  modelLoadError.value = ''
  const key = selectedKey.value
  const endpoint = apiBaseUrl.value
  if (!key?.key?.trim() || !endpoint) {
    if (key && keyCredentialsReady.value && !key.key?.trim()) {
      modelLoadError.value = '当前 API Key 没有可用密钥值，请刷新或重新选择密钥。'
    }
    loadingModels.value = false
    return
  }

  try {
    let batchNames: string[] = []
    let batchError: unknown = null
    try {
      batchNames = await fetchModelNames(`${endpoint}/images/batches/models`, key.key)
    } catch (error) {
      batchError = error
    }
    if (requestId !== modelRequestId) return

    let names = batchNames
    let genericError: unknown = null
    if (!names.length) {
      try {
        names = await fetchModelNames(`${endpoint}/models`, key.key, true)
      } catch (error) {
        genericError = error
      }
      if (requestId !== modelRequestId) return
    }

    imageModels.value = deduplicateModelNames(names)
    imageModel.value = preferredModel && imageModels.value.includes(preferredModel)
      ? preferredModel
      : imageModels.value[0] || ''

    if (!imageModels.value.length && (batchError || genericError)) {
      modelLoadError.value = errorMessageFrom(genericError || batchError)
    }
  } catch (error) {
    if (requestId === modelRequestId) {
      modelLoadError.value = errorMessageFrom(error)
    }
  } finally {
    if (requestId === modelRequestId) {
      loadingModels.value = false
    }
  }
}

// 手动刷新密钥、设置和模型，用于切换后状态没跟上的场景。
// 保留当前已选模型（只要它仍然可用），避免刷新后又被重置成第一个。
async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  errorMessage.value = ''
  modelLoadError.value = ''
  const previousModel = imageModel.value
  try {
    await loadKeysAndSettings()
    // 等密钥 watch 跑完，避免它的异步 loadModels 覆盖下面的结果。
    await nextTick()
    await loadModels()
    if (previousModel && imageModels.value.includes(previousModel)) {
      imageModel.value = previousModel
    }
  } finally {
    refreshing.value = false
  }
}

async function fetchModelNames(endpoint: string, apiKey: string, filterImages = false): Promise<string[]> {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `${response.status} ${response.statusText}`)
  }

  const names: string[] = Array.isArray(payload?.data)
    ? payload.data
      .map((item: any) => {
        if (typeof item === 'string') return item
        return item?.id || item?.model || item?.name || ''
      })
      .map((name: unknown) => String(name).trim())
      .filter(Boolean)
    : []
  const uniqueNames = Array.from(new Set(names))
  return filterImages ? uniqueNames.filter(isImageModel) : uniqueNames
}

function errorMessageFrom(error: unknown, fallback = '加载图片模型失败') {
  if (isCreationServiceUnavailable(error)) return ''
  // 后端对"没开启"和"凭证不全"给了可区分的业务码，直接给出可执行的下一步，
  // 而不是让用户对着笼统的失败提示猜。
  const reason = typeof error === 'object' && error !== null && 'reason' in error
    ? String((error as { reason?: unknown }).reason || '')
    : ''
  if (reason === 'IMAGE_STORAGE_DISABLED' || reason === 'IMAGE_STORAGE_INCOMPLETE') {
    if (!authStore.isAdmin) return ''
    return reason === 'IMAGE_STORAGE_DISABLED'
      ? '图片存储未启用：请到后台「设置 → 数据备份」打开「异步生图对象存储」。'
      : '图片存储凭证不完整：请到后台「设置 → 数据备份」补齐存储桶与密钥。'
  }
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : ''
  const normalized = message.trim().toLowerCase()
  if (!normalized) return fallback
  if (
    normalized === 'failed to fetch' ||
    normalized.includes('networkerror') ||
    normalized.includes('network error')
  ) {
    return '无法连接到 API 服务，请检查网络或 API 地址。'
  }
  if (
    normalized.includes('insufficient account balance') ||
    normalized.includes('insufficient_balance') ||
    normalized.includes('insufficient balance') ||
    normalized.includes('余额不足')
  ) {
    return '账户余额不足，请先充值或换一个有余额的 API Key。'
  }
  if (
    normalized.includes('service temporarily unavailable') ||
    normalized.includes('upstream service temporarily unavailable')
  ) {
    return '当前模型暂时不可用，请稍后重试或换一个模型。'
  }
  if (
    normalized.includes('api key is required') ||
    normalized.includes('authorization header')
  ) {
    return '当前 API Key 未正确传给服务，请刷新页面或重新选择可用密钥。'
  }
  return message || fallback
}

function isImageStorageConfigError(error: unknown): boolean {
  const reason = typeof error === 'object' && error !== null && 'reason' in error
    ? String((error as { reason?: unknown }).reason || '')
    : ''
  return reason === 'IMAGE_STORAGE_DISABLED' || reason === 'IMAGE_STORAGE_INCOMPLETE'
}

function isImageModel(name: string) {
  const value = name.trim().toLowerCase()
  return value.startsWith('gpt-image-') ||
    value.includes('dall-e') ||
    value.includes('image') ||
    value.includes('nano-banana') ||
    value.includes('banana') ||
    value.includes('imagen') ||
    value.includes('flux') ||
    value.includes('sdxl')
}

function isGrokImageModelName(name: string) {
  const value = name.trim().toLowerCase()
  return value.includes('grok-imagine') && !value.includes('video')
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

function isGeminiModel(name: string) {
  const value = name.toLowerCase()
  return value.includes('banana') || (value.includes('gemini') && isImageModel(name))
}

async function generate() {
  if (!canGenerate.value || !selectedKey.value) return
  generating.value = true
  activeGenerations.value += 1
  const currentPrompt = prompt.value.trim()
  const requestCount = Math.min(Math.max(Number(count.value) || 1, 1), 4)
  const batchId = createImageGenerationTaskId()
  const startedAt = Date.now()
  const pendingImages = Array.from({ length: requestCount }, (_, index): GeneratedImage => ({
    id: nextImageId++,
    title: `正在生成 ${index + 1}`,
    src: '',
    meta: `${format.value.toUpperCase()} · ${size.value} · ${imageModel.value}`,
    pending: true,
    taskId: createImageGenerationTaskId(),
    batchId,
    apiKeyId: selectedKey.value?.id,
    startedAt,
    prompt: currentPrompt,
    model: imageModel.value,
    size: size.value,
    format: format.value,
    quality: quality.value,
    background: background.value,
  }))
  images.value.unshift(...pendingImages)
  persistPendingImages()
  errorMessage.value = ''
  const geminiModel = isGeminiModel(imageModel.value)
  const grokModel = isGrokImageModel.value
  const progress = createGenerationProgress()
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${selectedKey.value.key}` }
    let url = `${apiBaseUrl.value}${hasReferences.value ? '/images/edits' : '/images/generations'}`
    let body: string | FormData
    if (geminiModel) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(buildGeminiPayload(currentPrompt))
      url = buildGeminiURL(imageModel.value)
    } else if (hasReferences.value) {
      body = buildEditForm(currentPrompt)
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({
        model: imageModel.value.trim(),
        prompt: currentPrompt,
        size: size.value,
        quality: quality.value,
        output_format: format.value,
        background: background.value,
        n: 1,
        response_format: 'b64_json',
        ...(grokModel && appliedSize.mode === 'ratio'
          ? {
              resolution: grokResolutionForBase(appliedSize.aspectBase).toLowerCase(),
              aspect_ratio: appliedSize.aspectRatio,
            }
          : {}),
      })
    }
    const results = await executeGenerationRequests(
      pendingImages,
      url,
      headers,
      body,
      geminiModel,
      progress.enqueue,
    )
    for (const result of results) {
      if (result.status === 'rejected') progress.recordError(result.reason)
    }
    await progress.drain()
    removePendingImages(pendingImages.filter((image) => !progress.completedIds.has(image.id)))
    if (progress.generatedCount === 0) {
      throw progress.firstError || new Error('上游没有返回图片')
    }
    if (progress.firstError) {
      errorMessage.value = errorMessageFrom(progress.firstError, '部分图片生成失败')
    }
  } catch (error) {
    if (error instanceof ImageGenerationWaitCancelled) return
    removePendingImages(pendingImages)
    errorMessage.value = errorMessageFrom(error, '生成失败')
  } finally {
    activeGenerations.value -= 1
    generating.value = activeGenerations.value > 0
  }
}

function createGenerationProgress() {
  const completedIds = new Set<GeneratedImage['id']>()
  const inFlightIds = new Set<GeneratedImage['id']>()
  let generatedCount = 0
  let firstError: unknown = null
  let queue = Promise.resolve()
  let persistenceQueue = Promise.resolve()
  let persistenceNeedsRefresh = false

  const recordError = (error: unknown) => {
    if (!firstError) firstError = error
  }

  const enqueue: GenerationResultHandler = (image, result) => {
    if (completedIds.has(image.id) || inFlightIds.has(image.id)) return queue
    inFlightIds.add(image.id)
    queue = queue.then(async () => {
      if (result.status === 'rejected') {
        recordError(result.reason)
        return
      }
      if (!result.value.length) {
        recordError(new Error('上游没有返回图片'))
        return
      }
      const generated = await finishGenerationBatch(
        [image],
        [result],
        generatedCount + 1,
        false,
      )
      if (!generated.length) {
        recordError(new Error('上游没有返回可用图片'))
        return
      }
      completedIds.add(image.id)
      generatedCount += generated.length
      persistenceQueue = persistenceQueue
        .then(async () => {
          const saved = await persistGeneratedImages(
            generated,
            image.prompt || prompt.value.trim(),
            image.model || imageModel.value,
            { refresh: false },
          )
          if (saved) persistenceNeedsRefresh = true
        })
        .catch(recordError)
    }).catch((error) => {
      recordError(error)
    }).finally(() => {
      inFlightIds.delete(image.id)
    })
    return queue
  }

  return {
    completedIds,
    enqueue,
    recordError,
    drain: async () => {
      await queue
      await persistenceQueue
      if (persistenceNeedsRefresh) {
        await Promise.allSettled([loadGallery(), loadStudioQuota()])
      }
    },
    get generatedCount() {
      return generatedCount
    },
    get firstError() {
      return firstError
    },
  }
}

function removePendingImages(pendingImages: GeneratedImage[]) {
  const pendingIds = new Set(pendingImages.map((item) => item.id))
  images.value = images.value.filter((item) => !pendingIds.has(item.id))
  persistPendingImages()
}

function gatewayAsyncSubmitUrl(syncUrl: string, geminiModel: boolean) {
  if (geminiModel) {
    return `${apiBaseUrl.value.replace(/\/+$/, '')}/images/generations/async`
  }
  return syncUrl.replace(/\/images\/(generations|edits)$/, '/images/$1/async')
}

function gatewayTaskPayload(payload: any) {
  return payload?.data && !payload?.task_id && !payload?.id ? payload.data : payload
}

function gatewayTaskError(payload: any): Error {
  return new Error(
    payload?.error?.message
    || payload?.error
    || payload?.message
    || '图片生成任务失败',
  )
}

function resolveGatewayPollUrl(raw: string) {
  if (/^https?:\/\//i.test(raw)) return raw
  const fallbackOrigin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'http://localhost'
  const apiBase = new URL(apiBaseUrl.value || fallbackOrigin, fallbackOrigin)
  return new URL(raw, apiBase.origin).toString()
}

async function waitForGatewayPollRetry(delay: number) {
  if (componentDisposed) throw new ImageGenerationWaitCancelled()
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  if (componentDisposed) throw new ImageGenerationWaitCancelled()
}

function gatewayPollInterval(elapsedMs: number) {
  if (elapsedMs < 10_000) return 500
  if (elapsedMs < 60_000) return 1500
  return 2000
}

function imageResultWithTaskTiming(
  items: any[],
  completedAt: number,
  startedAt?: number,
) {
  const durationMs = Number(startedAt || 0) > 0
    ? Math.max(1, completedAt - Number(startedAt))
    : undefined
  return items.map((item) => ({
    ...(item && typeof item === 'object' ? item : { result: item }),
    __imageTaskCompletedAt: completedAt,
    __imageTaskDurationMs: durationMs,
  }))
}

async function pollGatewayImageTask(
  pollUrl: string,
  headers: Record<string, string>,
  options: { isCancelled?: () => boolean } = {},
): Promise<any[]> {
  const deadline = Date.now() + 30 * 60 * 1000
  const pollStartedAt = Date.now()
  const url = resolveGatewayPollUrl(pollUrl)
  let retryAttempt = 0
  while (Date.now() < deadline) {
    if (options.isCancelled?.()) throw new ImageGenerationWaitCancelled()
    let response: Response
    let payload: any
    try {
      response = await fetch(url, { headers })
      payload = await response.json().catch(() => null)
    } catch {
      retryAttempt += 1
      await waitForGatewayPollRetry(Math.min(30_000, 1500 * (2 ** Math.min(retryAttempt - 1, 5))))
      continue
    }
    if (response.status === 429 || response.status >= 500) {
      retryAttempt += 1
      await waitForGatewayPollRetry(Math.min(30_000, 1500 * (2 ** Math.min(retryAttempt - 1, 5))))
      continue
    }
    if (!response.ok) throw gatewayTaskError(payload)
    retryAttempt = 0
    const task = gatewayTaskPayload(payload)
    if (task?.status === 'completed') {
      const result = task.result
      const normalized = typeof result === 'string' ? JSON.parse(result) : result
      return extractImages(normalized)
    }
    if (task?.status === 'failed') throw gatewayTaskError(task.error || task)
    await waitForGatewayPollRetry(gatewayPollInterval(Date.now() - pollStartedAt))
  }
  throw new Error('图片生成超时，请稍后重试')
}

async function tryExecuteGatewayAsyncRequests(
  pendingImages: GeneratedImage[],
  syncUrl: string,
  headers: Record<string, string>,
  body: string | FormData,
  geminiModel: boolean,
  onResult?: GenerationResultHandler,
): Promise<PromiseSettledResult<any[]>[] | null> {
  const submitUrl = gatewayAsyncSubmitUrl(syncUrl, geminiModel)
  const submitted: Array<{ image: GeneratedImage; pollUrl: string }> = []
  const results: PromiseSettledResult<any[]>[] = []

  for (const image of pendingImages) {
    let requestBody: string | FormData = body
    if (geminiModel) {
      if (typeof body !== 'string') throw new Error('Gemini 图片请求格式无效')
      requestBody = JSON.stringify({
        model: image.model || imageModel.value,
        request: JSON.parse(body),
      })
    }
    const requestHeaders = {
      ...headers,
      'Idempotency-Key': image.taskId || createImageGenerationTaskId(),
    }
    image.gatewaySubmitPending = true
    persistPendingImages()
    let response: Response | null = null
    let payload: any = null
    let requestError: unknown = null
    let ambiguousAttempt = false
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      requestError = null
      try {
        response = await fetch(submitUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
        })
        payload = await response.json().catch(() => null)
      } catch (error) {
        response = null
        requestError = error
        ambiguousAttempt = true
      }
      const retryable = !response || isRetryableGatewaySubmitStatus(response.status)
      if (!response || isAmbiguousGatewaySubmitStatus(response.status)) {
        ambiguousAttempt = true
      }
      if (!retryable || attempt === 2) break
      await new Promise((resolve) => window.setTimeout(resolve, 500))
    }
    if (!response) {
      const reason = requestError instanceof Error
        ? requestError
        : new Error('提交图片任务失败')
      if (!submitted.length) throw reason
      results.push({ status: 'rejected', reason })
      continue
    }
    if (response.status === 404) {
      if (!submitted.length && !ambiguousAttempt) {
        for (const pendingImage of pendingImages) {
          pendingImage.gatewaySubmitPending = false
        }
        persistPendingImages()
        return null
      }
      results.push({ status: 'rejected', reason: gatewayTaskError(payload) })
      continue
    }
    if (!response.ok) {
      const error = gatewayTaskError(payload)
      if (!submitted.length) throw error
      results.push({ status: 'rejected', reason: error })
      continue
    }
    const task = gatewayTaskPayload(payload)
    if (!task?.poll_url) {
      const error = new Error('服务端没有返回图片任务地址')
      if (!submitted.length) throw error
      results.push({ status: 'rejected', reason: error })
      continue
    }
    image.gatewayTaskId = String(task.task_id || task.id || '')
    image.gatewayPollUrl = String(task.poll_url)
    image.taskId = image.gatewayTaskId || image.taskId
    image.gatewaySubmitPending = false
    submitted.push({ image, pollUrl: String(task.poll_url) })
    persistPendingImages()
  }

  const polled = await Promise.allSettled(
    submitted.map(async (task) => {
      const items = await pollGatewayImageTask(task.pollUrl, headers, {
        isCancelled: () => componentDisposed,
      })
      const result = {
        status: 'fulfilled' as const,
        value: imageResultWithTaskTiming(items, Date.now(), task.image.startedAt),
      }
      await onResult?.(task.image, result)
      return result.value
    }),
  )
  for (const image of pendingImages) {
    if (!image.gatewayPollUrl) image.gatewaySubmitPending = false
  }
  persistPendingImages()
  return [...results, ...polled]
}

function isRetryableGatewaySubmitStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isAmbiguousGatewaySubmitStatus(status: number) {
  return status === 408 || status >= 500
}

async function resumeGatewayGeneration(pendingImages: GeneratedImage[]) {
  if (!selectedKey.value?.key) return
  const batches = new Map<string, GeneratedImage[]>()
  for (const image of pendingImages) {
    if (!image.gatewayPollUrl) continue
    const batchId = image.batchId || image.gatewayTaskId || image.gatewayPollUrl
    if (resumedGatewayBatches.has(batchId)) continue
    const batch = batches.get(batchId) || []
    batch.push(image)
    batches.set(batchId, batch)
  }
  for (const [batchId, batch] of batches) {
    resumedGatewayBatches.add(batchId)
    activeGenerations.value += 1
    generating.value = true
    const progress = createGenerationProgress()
    try {
      const apiKeyId = batch[0]?.apiKeyId
      const taskKey = apiKeyId
        ? imageCapableKeys.value.find((key) => Number(key.id) === Number(apiKeyId))
        : selectedKey.value
      if (!taskKey?.key) {
        removePendingImages(batch)
        errorMessage.value = '找不到发起这组图片任务时使用的密钥，请重新生成。'
        continue
      }
      const headers = { Authorization: `Bearer ${taskKey.key}` }
      const results = await Promise.allSettled(
        batch.map(async (image) => {
          const items = await pollGatewayImageTask(image.gatewayPollUrl!, headers, {
            isCancelled: () => componentDisposed,
          })
          const result = {
            status: 'fulfilled' as const,
            value: imageResultWithTaskTiming(items, Date.now(), image.startedAt),
          }
          await progress.enqueue(image, result)
          return result.value
        }),
      )
      for (const result of results) {
        if (result.status === 'rejected') progress.recordError(result.reason)
      }
      await progress.drain()
      removePendingImages(batch.filter((image) => !progress.completedIds.has(image.id)))
      if (progress.generatedCount === 0) {
        throw progress.firstError || new Error('上游没有返回图片')
      }
      if (progress.firstError) {
        errorMessage.value = errorMessageFrom(progress.firstError, '部分图片生成失败')
      }
    } catch (error) {
      if (error instanceof ImageGenerationWaitCancelled) return
      removePendingImages(batch)
      errorMessage.value = errorMessageFrom(error, '恢复图片生成任务失败')
    } finally {
      resumedGatewayBatches.delete(batchId)
      activeGenerations.value = Math.max(0, activeGenerations.value - 1)
      generating.value = activeGenerations.value > 0
    }
  }
}

function workerResponseToSettledResult(
  response: ImageGenerationWorkerResponse,
): PromiseSettledResult<any[]> {
  let payload: any = null
  try {
    payload = response.body ? JSON.parse(response.body) : null
  } catch {
    // Non-JSON upstream errors are handled below.
  }
  if (!response.ok) {
    return {
      status: 'rejected',
      reason: new Error(
        payload?.error?.message
        || payload?.message
        || payload?.error
        || response.body
        || `${response.status} ${response.statusText}`,
      ),
    }
  }
  try {
    return {
      status: 'fulfilled',
      value: imageResultWithTaskTiming(
        extractImages(payload),
        Number(response.completedAt || 0),
        Number(response.startedAt || 0),
      ),
    }
  } catch (error) {
    return { status: 'rejected', reason: error }
  }
}

async function executeGenerationRequests(
  pendingImages: GeneratedImage[],
  url: string,
  headers: Record<string, string>,
  body: string | FormData,
  geminiModel: boolean,
  onResult?: GenerationResultHandler,
): Promise<PromiseSettledResult<any[]>[]> {
  let gatewayResults: PromiseSettledResult<any[]>[] | null = null
  gatewayResults = await tryExecuteGatewayAsyncRequests(
    pendingImages,
    url,
    headers,
    body,
    geminiModel,
    onResult,
  )
  if (gatewayResults) return gatewayResults

  const taskRequests = pendingImages
    .filter((image): image is GeneratedImage & { taskId: string } => Boolean(image.taskId))
    .map((image) => ({
      id: image.taskId,
      url,
      init: {
        method: 'POST' as const,
        headers,
        body,
      },
      createdAt: image.startedAt || Date.now(),
    }))

  if (taskRequests.length === pendingImages.length) {
    const started = await tryStartPersistentImageGeneration(taskRequests)
    if (started) {
      const imagesByTaskId = new Map(
        pendingImages.map((image) => [String(image.taskId), image]),
      )
      const responses = await waitForPersistentImageGeneration(
        taskRequests.map((request) => request.id),
        {
          isCancelled: () => componentDisposed,
          onResponse: async (id, response) => {
            const image = imagesByTaskId.get(id)
            if (!image) return
            await onResult?.(image, workerResponseToSettledResult(response))
          },
        },
      )
      return responses.map(workerResponseToSettledResult)
    }
  }

  return Promise.allSettled(pendingImages.map(async (image) => {
    const response = await fetch(url, { method: 'POST', headers, body })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `${response.status} ${response.statusText}`)
    }
    const result = {
      status: 'fulfilled' as const,
      value: imageResultWithTaskTiming(extractImages(payload), Date.now(), image.startedAt),
    }
    await onResult?.(image, result)
    return result.value
  }))
}

async function finishGenerationBatch(
  pendingImages: GeneratedImage[],
  results: PromiseSettledResult<any[]>[],
  titleStart = 1,
  persist = true,
) {
  const items: any[] = []
  let firstError: unknown = null
  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else if (!firstError) {
      firstError = result.reason
    }
  }
  if (!items.length) {
    throw firstError || new Error('上游没有返回图片')
  }
  if (firstError) {
    errorMessage.value = errorMessageFrom(firstError, '部分图片生成失败')
  }

  const firstPending = pendingImages[0]
  const currentPrompt = firstPending?.prompt || prompt.value.trim()
  const currentModel = firstPending?.model || imageModel.value
  const requestedFormat = firstPending?.format || format.value
  const requestedSize = firstPending?.size || size.value
  const completedAtMs = Date.now()
  const fallbackDurationMs = Number(firstPending?.startedAt || 0) > 0
    ? Math.max(1, completedAtMs - Number(firstPending.startedAt))
    : undefined
  const generated: GeneratedImage[] = []
  let localProcessError = ''
  const needsLocalResize = imageNeedsLocalResize(requestedSize, IMAGE_MAX_EDGE)
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const mime = String(item.mimeType || item.mime_type || 'image/png')
    const b64 = String(item.b64_json || item.data || '')
    const rawSrc = b64 ? `data:${mime};base64,${b64}` : String(item.url || '')
    if (!rawSrc) continue
    const previewSrc = String(item.preview_data_url || '')
    let src = rawSrc
    let actualFormat = imageFormatFromResult(item, rawSrc, requestedFormat)
    if (needsLocalResize) {
      const processed = await processImageForDisplay(rawSrc, requestedSize, requestedFormat)
      src = processed.src
      actualFormat = processed.format
      if (processed.error && !localProcessError) localProcessError = processed.error
    }
    const itemCompletedAt = Number(item.__imageTaskCompletedAt || 0)
    const itemDurationMs = Number(item.__imageTaskDurationMs || 0)
    generated.push({
      id: nextImageId++,
      title: `生成结果 ${titleStart + index}`,
      src,
      originalSrc: rawSrc,
      thumbSrc: previewSrc || undefined,
      prompt: currentPrompt,
      model: currentModel,
      size: requestedSize,
      format: actualFormat,
      quality: firstPending?.quality || quality.value,
      background: firstPending?.background || background.value,
      meta: `${actualFormat.toUpperCase()} · ${requestedSize} · ${currentModel}`,
      createdAt: Math.floor((itemCompletedAt > 0 ? itemCompletedAt : completedAtMs) / 1000),
      durationMs: itemDurationMs > 0 ? itemDurationMs : fallbackDurationMs,
    })
  }

  const pendingIds = new Set(pendingImages.map((item) => item.id))
  const pendingIndex = images.value.findIndex((item) => pendingIds.has(item.id))
  images.value = images.value.filter((item) => !pendingIds.has(item.id))
  if (pendingIndex >= 0) {
    images.value.splice(Math.min(pendingIndex, images.value.length), 0, ...generated)
  }
  persistPendingImages()
  if (localProcessError) {
    appStore.showWarning('本地尺寸处理失败，已保留并显示上游原图。', 6000)
  }
  if (persist) {
    await persistGeneratedImages(generated, currentPrompt, currentModel)
  }
  return generated
}

function buildGeminiURL(model: string) {
  const root = apiBaseUrl.value.replace(/\/+$/, '').replace(/\/v1$/, '')
  const prefix = selectedKey.value?.group?.platform === 'antigravity' ? '/antigravity/v1beta' : '/v1beta'
  return `${root}${prefix}/models/${encodeURIComponent(model)}:generateContent`
}

function buildGeminiPayload(text: string) {
  const parts: any[] = []
  references.value.forEach((item, index) => {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(item.preview)
    parts.push({ text: `图片${index + 1}` })
    parts.push(match ? { inlineData: { mimeType: match[1], data: match[2] } } : { text: item.name })
  })
  parts.push({ text })
  const imageConfig: Record<string, string> = {
    aspectRatio: geminiAspectRatio(size.value),
  }
  const imageSize = geminiImageSizeForQuality(quality.value)
  if (imageSize) imageConfig.imageSize = imageSize
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig,
    },
  }
}

function geminiImageSizeForQuality(value: string) {
  if (value === 'high') return '4K'
  if (value === 'medium') return '2K'
  if (value === 'low') return '1K'
  return undefined
}

function geminiAspectRatio(value: string) {
  if (appliedSize.mode === 'ratio') {
    return appliedSize.useCustomRatio
      ? `${appliedSize.customRatioWidth}:${appliedSize.customRatioHeight}`
      : appliedSize.aspectRatio
  }
  if (value === 'auto') return '1:1'
  const dimensions = parseSize(value)
  if (!dimensions) return '1:1'
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height)
  return `${Math.round(dimensions.width / divisor)}:${Math.round(dimensions.height / divisor)}`
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? Math.max(1, a) : greatestCommonDivisor(b, a % b)
}

function buildEditForm(text: string) {
  const form = new FormData()
  form.append('model', imageModel.value.trim())
  form.append('prompt', text)
  form.append('size', size.value)
  form.append('quality', quality.value)
  form.append('output_format', format.value)
  form.append('background', background.value)
  form.append('n', '1')
  form.append('response_format', 'b64_json')
  references.value.forEach((item) => form.append('image[]', item.file, item.name))
  return form
}

function extractImages(payload: any): any[] {
  if (!payload) return []
  if (Array.isArray(payload.data)) return payload.data.flatMap(extractImages)
  const geminiResults = extractGeminiImageResults(payload)
  if (geminiResults.length) return geminiResults
  if (Array.isArray(payload.response?.output)) return payload.response.output
  if (Array.isArray(payload.output)) return payload.output
  if (payload.b64_json || payload.url || payload.result) return [payload]
  return []
}

function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  addFiles(Array.from(input.files || []))
  input.value = ''
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
  if (files.length) addFiles(files)
}

function onDropReferences(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'))
  if (files.length) addFiles(files)
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

function addFiles(files: File[]) {
  const available = Math.max(0, 14 - references.value.length)
  files
    .filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    .slice(0, available)
    .forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        references.value.push({
          id: nextReferenceId++,
          name: file.name || 'reference.png',
          file,
          preview: String(reader.result || ''),
        })
      }
      reader.readAsDataURL(file)
    })
}

function removeReference(id: number) {
  references.value = references.value.filter((item) => item.id !== id)
}

function insertReferenceToken(index: number) {
  const token = `图片${index}`
  const textarea = promptTextareaRef.value
  if (!textarea) {
    prompt.value = `${prompt.value}${prompt.value.trim() ? ' ' : ''}${token}`
    return
  }
  const start = textarea.selectionStart ?? prompt.value.length
  const end = textarea.selectionEnd ?? start
  const before = prompt.value.slice(0, start)
  const after = prompt.value.slice(end)
  const prefix = before && !/\s$/.test(before) ? ' ' : ''
  const suffix = after && !/^\s/.test(after) ? ' ' : ''
  const nextValue = `${before}${prefix}${token}${suffix}${after}`
  const cursor = before.length + prefix.length + token.length
  prompt.value = nextValue
  void nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(cursor, cursor)
  })
}

async function downloadImage(image: GeneratedImage) {
  const filename = `${image.title}.${image.format || 'png'}`
  const id = galleryIdFor(image)
  if (id && galleryBackedIds.value.has(id)) {
    try {
      const blob = await imageStudioGalleryAPI.download(id)
      saveBlob(blob, filename)
      return
    } catch {
      // Fall through to the direct URL path below.
    }
  }
  const link = document.createElement('a')
  link.href = image.src
  link.download = filename
  link.click()
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function copyPreviewPrompt() {
  const text = previewPromptDraft.value.trim()
  if (!text) return
  void copyToClipboard(text, '提示词已复制')
}

function applyPreviewSettings(image: GeneratedImage) {
  if (image.model && imageModels.value.includes(image.model)) {
    imageModel.value = image.model
  }
  if (image.format && formatOptions.some((option) => option.value === image.format)) {
    format.value = image.format
  }
  if (image.quality && qualityOptions.some((option) => option.value === image.quality)) {
    quality.value = image.quality
  }
  if (image.background && backgroundOptions.some((option) => option.value === image.background)) {
    background.value = image.background
  }
  if (image.size === 'auto') {
    appliedSize.mode = 'auto'
    return
  }
  const dimensions = image.size ? parseSize(image.size) : null
  if (dimensions) {
    appliedSize.mode = 'custom'
    appliedSize.width = dimensions.width
    appliedSize.height = dimensions.height
  }
}

async function regenerateFromPreview() {
  const image = previewImage.value
  const text = previewPromptDraft.value.trim()
  if (!image || !text || !canRegeneratePreview.value) return
  applyPreviewSettings(image)
  prompt.value = text
  previewImage.value = null
  await generate()
}

watch(previewImage, (image) => {
  previewPromptDraft.value = image?.prompt || ''
  if (image) {
    void loadPreviewDisplay(image)
  } else {
    previewLoadToken += 1
    previewDisplaySrc.value = ''
  }
})

watch(prompt, (value) => {
  imageStudioDraft.initialized = true
  imageStudioDraft.prompt = value
})

watch(
  references,
  (value) => {
    imageStudioDraft.initialized = true
    imageStudioDraft.references = value.map((item) => ({ ...item }))
  },
  { deep: true, flush: 'post' },
)

watch(errorMessage, (message) => {
  if (!message) return
  appStore.showError(message, 5000)
  errorMessage.value = ''
})

watch(selectedKeyId, (keyId) => {
  if (keyId) writeStudioPreferences({ keyId })
})

watch([selectedKeyId, apiBaseUrl, () => selectedKey.value?.key], () => {
  void loadModels()
})

watch(imageModel, (model, previousModel) => {
  if (!model || model === previousModel) return
  resetParametersForModel(model)
  if (imageModels.value.includes(model)) {
    writeStudioPreferences({ model })
  }
})

watch(
  [keys, imageModels, selectedKeyId, imageModel, images],
  writeStudioSnapshot,
  { deep: true, flush: 'post' },
)

watch(
  () => activeGenerations.value > 0 || images.value.some((image) => image.pending),
  (hasActiveGeneration) => {
    if (hasActiveGeneration) startGenerationClock()
    else stopGenerationClock()
  },
  { immediate: true },
)

onMounted(() => {
  componentDisposed = false
  document.addEventListener('click', handleSizeOutside)
  document.addEventListener('keydown', handleSizeEscape)
  applyInspirationFromRoute()
  void loadData()
})
onActivated(() => {
  componentDisposed = false
  if (activeGenerations.value > 0 || images.value.some((image) => image.pending)) {
    startGenerationClock()
  }
  applyInspirationFromRoute()
  const restored = images.value.filter((item) => item.pending && item.taskId && !item.gatewayPollUrl)
  if (restored.length) void resumePersistentGeneration(restored)
  const gatewayPending = images.value.filter((item) => item.pending && item.gatewayPollUrl)
  if (gatewayPending.length) void resumeGatewayGeneration(gatewayPending)
})
onDeactivated(() => {
  stopGenerationClock()
})
onBeforeUnmount(() => {
  componentDisposed = true
  stopGenerationClock()
  document.removeEventListener('click', handleSizeOutside)
  document.removeEventListener('keydown', handleSizeEscape)
  for (const url of galleryThumbObjectUrls.values()) {
    URL.revokeObjectURL(url)
  }
  galleryThumbObjectUrls.clear()
})
</script>

<style scoped>
.toolbar-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.4rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.85);
  padding: 0 0.6rem;
}

.toolbar-field span,
.composer-field span {
  white-space: nowrap;
  font-size: 0.75rem;
  color: rgb(100 116 139);
}

.toolbar-field select,
.toolbar-field input {
  min-width: 8rem;
  border: 0;
  background: transparent;
  color: rgb(15 23 42);
  font-size: 0.82rem;
  outline: none;
}

.toolbar-error {
  font-size: 0.75rem;
  color: rgb(220 38 38);
}

.toolbar-field .toolbar-image-select {
  min-width: 8.5rem;
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

.toolbar-field .toolbar-image-select--model {
  min-width: 10rem;
}

.composer-prompt-wrap {
  position: relative;
}

.composer-prompt {
  display: block;
  min-height: 3.5rem;
  max-height: clamp(8rem, 30vh, 13.75rem);
  overflow-y: hidden;
  padding-right: 2.5rem;
  line-height: 1.65;
  transition: height 0.16s ease;
}

.composer-prompt-toggle {
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

.composer-prompt-toggle:hover {
  background: rgb(241 245 249);
  color: rgb(173 74 41);
}

.composer-size-trigger {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.4rem;
  min-width: 8.5rem;
  height: 2.25rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.65rem;
  background: linear-gradient(180deg, rgb(255 255 255), rgb(240 253 250));
  padding: 0 0.55rem;
  color: rgb(51 65 85);
  text-align: left;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.composer-size-trigger:hover {
  border-color: rgb(45 212 191);
  box-shadow: 0 6px 16px rgb(20 184 166 / 0.14);
}

.composer-size-trigger span {
  font-size: 0.72rem;
  color: rgb(100 116 139);
}

.composer-size-trigger strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(30 41 59);
}

.composer-field {
  display: grid;
  gap: 0.2rem;
  min-width: 5.5rem;
}

.composer-field select,
.composer-field input {
  height: 2rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.4rem;
  background: rgb(248 250 252);
  padding: 0 0.45rem;
  color: rgb(30 41 59);
  font-size: 0.78rem;
}

.composer-field--count {
  min-width: 7rem;
}

.count-stepper {
  display: grid;
  grid-template-columns: 1.7rem minmax(2.2rem, 1fr) 1.7rem;
  align-items: center;
  height: 2.35rem;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255 / 0.92);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
}

.count-stepper__button {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: rgb(100 116 139);
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.count-stepper__button:hover:not(:disabled) {
  background: rgb(240 253 250);
  color: rgb(13 148 136);
}

.count-stepper__button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.count-stepper input {
  width: 100%;
  height: 100%;
  border: 0;
  border-right: 1px solid rgb(241 245 249);
  border-left: 1px solid rgb(241 245 249);
  border-radius: 0;
  background: transparent;
  padding: 0;
  color: rgb(30 41 59);
  font-size: 0.82rem;
  font-weight: 600;
  text-align: center;
  outline: none;
  appearance: textfield;
}

.count-stepper input::-webkit-outer-spin-button,
.count-stepper input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.size-dialog {
  --soft-text: rgb(30 41 59);
  --soft-muted: rgb(100 116 139);
  --soft-line: rgb(226 232 240);
  --soft-panel: rgb(248 250 252);
  --soft-accent: rgb(13 148 136);
  color: var(--soft-text);
}

.size-dialog__current {
  margin: -0.25rem 0 1rem;
  font-size: 0.78rem;
  color: var(--soft-muted);
}

.size-dialog__current strong {
  font-weight: 600;
  color: rgb(51 65 85);
}

.size-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  border-radius: 999px;
  background: rgb(240 253 250);
  padding: 0.3rem;
}

.size-tab {
  min-height: 2.25rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(71 85 105);
  font-size: 0.82rem;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.size-tab.active {
  background: rgb(255 255 255);
  color: rgb(15 118 110);
  box-shadow: 0 4px 12px rgb(13 148 136 / 0.14);
}

.size-dialog__content {
  display: flex;
  min-height: 27rem;
  flex-direction: column;
  padding-top: 1.2rem;
}

.size-auto-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem 4rem;
  text-align: center;
}

.size-auto-icon {
  display: flex;
  width: 3.5rem;
  height: 3.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgb(204 251 241);
  color: var(--soft-accent);
  box-shadow: 0 10px 26px rgb(13 148 136 / 0.14);
}

.size-auto-title {
  margin-top: 1.1rem;
  font-size: 1rem;
  font-weight: 600;
}

.size-auto-description {
  margin-top: 0.6rem;
  font-size: 0.82rem;
  line-height: 1.8;
  color: rgb(100 116 139);
}

.size-section + .size-section {
  margin-top: 1.15rem;
}

.size-section__label {
  margin-bottom: 0.55rem;
  font-size: 0.76rem;
  color: var(--soft-muted);
}

.size-base-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.size-base-option,
.size-ratio-option,
.size-custom-ratio-toggle {
  border: 1px solid var(--soft-line);
  background: rgb(255 255 255 / 0.72);
  color: rgb(71 85 105);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.size-base-option {
  min-height: 2.45rem;
  border-radius: 0.65rem;
  font-size: 0.82rem;
}

.size-base-option.active,
.size-ratio-option.active,
.size-custom-ratio-toggle.active {
  border-color: rgb(45 212 191);
  background: rgb(240 253 250);
  box-shadow: 0 6px 18px rgb(13 148 136 / 0.13);
}

.size-ratio-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
}

.size-ratio-option {
  display: flex;
  min-height: 4.2rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border-radius: 0.75rem;
  font-size: 0.76rem;
}

.size-ratio-shape {
  display: block;
  width: 1.75rem;
  max-height: 1.8rem;
  border: 1.5px solid currentColor;
  border-radius: 0.25rem;
  opacity: 0.7;
}

.size-custom-ratio-toggle {
  width: 100%;
  min-height: 2.35rem;
  margin-top: 0.75rem;
  border-radius: 0.65rem;
  font-size: 0.78rem;
}

.size-custom-ratio {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.65rem;
}

.size-custom-ratio input,
.size-dimension-row input {
  width: 100%;
  height: 2.45rem;
  border: 1px solid var(--soft-line);
  border-radius: 0.65rem;
  background: rgb(255 255 255 / 0.75);
  padding: 0 0.7rem;
  color: rgb(30 41 59);
  font-size: 0.84rem;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.size-custom-ratio input:focus,
.size-dimension-row input:focus {
  border-color: rgb(45 212 191);
  box-shadow: 0 0 0 3px rgb(20 184 166 / 0.13);
}

.size-dimension-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: end;
  gap: 0.75rem;
}

.size-dimension-row label {
  display: grid;
  gap: 0.45rem;
  font-size: 0.76rem;
  color: var(--soft-muted);
}

.size-dimension-separator {
  padding-bottom: 0.55rem;
  color: rgb(148 163 184);
}

.size-dimension-hint {
  margin-top: 0.9rem;
  border-left: 3px solid rgb(94 234 212);
  border-radius: 0.35rem;
  background: rgb(240 253 250);
  padding: 0.7rem 0.85rem;
  font-size: 0.72rem;
  line-height: 1.65;
  color: rgb(71 85 105);
}

.size-preview {
  display: grid;
  gap: 0.25rem;
  margin-top: auto;
  border-radius: 0.85rem;
  background: rgb(240 253 250);
  padding: 0.9rem 1rem;
}

.size-preview span {
  font-size: 0.72rem;
  color: var(--soft-muted);
}

.size-preview strong {
  font-size: 0.96rem;
  font-weight: 600;
  color: rgb(15 23 42);
}

.size-dialog__issue {
  margin-top: 0.6rem;
  border-radius: 0.75rem;
  background: rgb(254 243 199);
  padding: 0.6rem 0.85rem;
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgb(146 64 14);
}

.size-dialog__footer {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.size-dialog__cancel,
.size-dialog__confirm {
  min-height: 2.7rem;
  border: 0;
  border-radius: 0.7rem;
  font-size: 0.86rem;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.size-dialog__cancel {
  background: rgb(241 245 249);
  color: rgb(51 65 85);
}

.size-dialog__confirm {
  background: rgb(13 148 136);
  color: white;
  box-shadow: 0 8px 18px rgb(13 148 136 / 0.2);
}

.size-dialog__cancel:hover,
.size-dialog__confirm:hover {
  transform: translateY(-1px);
}

.size-dialog__confirm:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  transform: none;
}

.image-detail-dialog {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(18rem, 0.85fr);
  gap: 1rem;
  align-items: stretch;
}

.image-detail-dialog__media {
  display: flex;
  min-height: 28rem;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0.75rem;
  background: rgb(241 245 249);
  padding: 1rem;
}

.image-detail-dialog__media img {
  max-height: 72vh;
  max-width: 100%;
  border-radius: 0.5rem;
  object-fit: contain;
}

.image-detail-dialog__panel {
  display: flex;
  min-height: 28rem;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(248 250 252);
  padding: 1rem;
}

.image-detail-dialog__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: rgb(71 85 105);
  font-size: 0.85rem;
  font-weight: 700;
}

.image-detail-dialog__copy {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 0;
  background: transparent;
  color: rgb(100 116 139);
  font-size: 0.78rem;
}

.image-detail-dialog__prompt-input {
  flex: 1;
  min-height: 14rem;
  margin: 0.8rem 0 1rem;
  resize: vertical;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: white;
  padding: 0.7rem 0.8rem;
  color: rgb(15 23 42);
  font-family: inherit;
  font-size: 0.86rem;
  line-height: 1.65;
  outline: none;
}

.image-detail-dialog__prompt-input:focus {
  border-color: rgb(232 121 78);
  box-shadow: 0 0 0 3px rgb(232 121 78 / 0.12);
}

.image-detail-dialog__info {
  display: grid;
  gap: 0.55rem;
  margin: 0;
  border-top: 1px solid rgb(226 232 240);
  padding-top: 0.9rem;
}

.image-detail-dialog__info div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.image-detail-dialog__info dt {
  color: rgb(100 116 139);
  font-size: 0.75rem;
}

.image-detail-dialog__info dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: rgb(30 41 59);
  font-size: 0.78rem;
  font-weight: 600;
  text-align: right;
}

.image-detail-dialog__footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: flex-end;
}

.image-detail-dialog__regenerate {
  display: inline-flex;
  min-height: 2.4rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid rgb(232 121 78);
  border-radius: 0.6rem;
  background: rgb(232 121 78);
  padding: 0 1rem;
  color: white;
  font-size: 0.82rem;
  font-weight: 600;
}

.image-detail-dialog__regenerate:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.image-detail-dialog__download {
  display: inline-flex;
  min-height: 2.4rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.6rem;
  background: white;
  padding: 0 0.9rem;
  color: rgb(51 65 85);
  font-size: 0.82rem;
  font-weight: 600;
}

.image-detail-dialog__save {
  display: inline-flex;
  min-height: 2.4rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.6rem;
  background: white;
  padding: 0 0.9rem;
  color: rgb(51 65 85);
  font-size: 0.82rem;
  font-weight: 600;
}

.image-detail-dialog__save:disabled {
  cursor: wait;
  opacity: 0.65;
}

.image-detail-dialog__saved {
  display: inline-flex;
  min-height: 2.4rem;
  align-items: center;
  gap: 0.35rem;
  color: rgb(5 150 105);
  font-size: 0.8rem;
  font-weight: 600;
}

.image-composer {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.15rem 0.85rem 0.75rem;
  background: rgb(255 255 255);
}

.image-composer > * {
  flex-shrink: 0;
}

.image-composer__prompt-shell {
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

.image-composer__prompt-shell:focus-within {
  border-color: rgb(208 208 204);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.9),
    0 8px 24px rgb(24 24 27 / 0.05);
}

.image-composer__prompt {
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
  font-family: inherit;
  font-size: 0.92rem;
  line-height: 1.72;
  outline: none;
}

.image-composer__prompt::placeholder {
  color: rgb(156 156 151);
}

.image-composer__prompt-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.65rem 0.5rem;
}

.image-composer__model {
  min-width: 0;
  max-width: none;
  flex: 1 1 auto;
}

.image-composer__model :deep(.studio-select__trigger) {
  min-width: 0;
  height: 2.2rem;
  border-color: rgb(226 226 222);
  border-radius: 999px;
  background: rgb(255 255 255);
  padding: 0 0.75rem;
  box-shadow: none;
  font-size: 0.8rem;
}

.image-composer__model :deep(.studio-select__trigger span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-composer__model :deep(.studio-select__trigger:hover),
.image-composer__model :deep(.studio-select--open .studio-select__trigger) {
  border-color: rgb(201 201 196);
  box-shadow: none;
}

.image-composer__prompt-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.1rem;
}

.image-composer__prompt-actions button,
.image-composer__section-head button {
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

.image-composer__prompt-actions button:hover,
.image-composer__section-head button:hover {
  background: rgb(238 238 235);
  color: rgb(24 24 23);
}

.image-composer__references {
  border-radius: 0.8rem;
  padding: 0.1rem 0.15rem 0.35rem;
  transition:
    background 0.16s ease,
    outline-color 0.16s ease;
}

.image-composer__references:focus-within {
  outline: 2px solid rgb(24 24 27 / 0.08);
  outline-offset: 0.25rem;
}

.image-composer__section-head {
  display: flex;
  min-height: 1.65rem;
  align-items: center;
  justify-content: space-between;
  color: rgb(42 42 40);
  font-size: 0.82rem;
  font-weight: 600;
}

.image-composer__reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4.9rem, 1fr));
  gap: 0.55rem;
  margin-top: 0.4rem;
}

.image-composer__reference,
.image-composer__upload-tile {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 0.8rem;
}

.image-composer__reference {
  border: 1px solid rgb(231 231 228);
  background: rgb(245 245 243);
}

.image-composer__reference img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}

.image-composer__remove {
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

.image-composer__reference-index {
  position: absolute;
  top: 0.3rem;
  left: 0.3rem;
  border: 0;
  border-radius: 999px;
  background: rgb(24 24 27 / 0.72);
  padding: 0.18rem 0.42rem;
  color: white;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.2;
}

.image-composer__reference-index:hover {
  background: rgb(24 24 27 / 0.9);
}

.image-composer__reference-name {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.72));
  padding: 1.1rem 0.45rem 0.38rem;
  color: white;
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-composer__upload-tile {
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

.image-composer__upload-tile:hover {
  border-color: rgb(109 109 103);
  background: rgb(249 249 247);
}

.image-composer__helper {
  margin-top: 0.4rem;
  font-size: 0.68rem;
  line-height: 1.55;
  color: rgb(142 142 136);
}

.image-composer__toggle-row {
  display: flex;
  min-height: 1.9rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-radius: 0.75rem;
  color: rgb(42 42 40);
  font-size: 0.82rem;
  font-weight: 600;
}

.image-composer__field {
  display: grid;
  align-content: start;
  gap: 0.35rem;
}

.image-composer__option-grid {
  display: grid;
  align-items: start;
  gap: 0.85rem;
}

.image-composer__option-grid.is-split {
  grid-template-columns: minmax(0, 1.1fr) minmax(8.75rem, 0.9fr);
}

.image-composer__option-note {
  margin-top: -0.15rem;
  color: rgb(142 142 136);
  font-size: 0.68rem;
  line-height: 1.55;
}

.image-composer__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.image-composer__size-row {
  display: block;
}

.image-composer__label-row .image-composer__text-action {
  min-height: auto;
  padding: 0;
}

.image-composer__size-field {
  position: relative;
}

.image-composer__size-anchor {
  position: relative;
  min-width: 0;
}

.image-composer__size-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  left: 0;
  z-index: 35;
  max-height: min(21rem, 52vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgb(226 226 222);
  border-radius: 0.7rem;
  background: rgb(255 255 255);
  padding: 0.35rem;
  box-shadow: 0 18px 38px rgb(24 24 27 / 0.16);
}

.image-composer__size-menu.is-up {
  top: auto;
  bottom: calc(100% + 0.35rem);
}

.image-composer__size-option {
  display: flex;
  width: 100%;
  min-height: 2.2rem;
  align-items: center;
  gap: 0.55rem;
  border: 0;
  border-radius: 0.45rem;
  background: transparent;
  padding: 0 0.7rem;
  color: rgb(54 54 51);
  font-size: 0.8rem;
  text-align: left;
}

.image-composer__size-ratio-frame {
  display: flex;
  width: 1.3rem;
  height: 1.3rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.image-composer__size-ratio-shape {
  display: block;
  border: 1.5px solid currentColor;
  border-radius: 0.2rem;
  opacity: 0.72;
}

.image-composer__size-option:hover {
  background: rgb(247 247 245);
}

.image-composer__size-option.is-active {
  background: rgb(232 232 229);
  color: rgb(25 25 24);
  font-weight: 600;
}

.image-composer__size-option-note {
  margin: -0.15rem 0 0.35rem;
  padding: 0 0.7rem;
  color: rgb(142 142 136);
  font-size: 0.7rem;
}

.image-composer__size-group {
  margin: 0.45rem 0 0.15rem;
  padding: 0 0.7rem;
  color: rgb(142 142 136);
  font-size: 0.7rem;
}

.image-composer__custom-size {
  display: grid;
  gap: 0.48rem;
  margin-top: 0.55rem;
  border-top: 1px solid rgb(239 239 236);
  padding-top: 0.55rem;
}

.image-composer__custom-size-toggle {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  color: rgb(54 54 51);
  font-size: 0.68rem;
}

.image-composer__dimension-row {
  display: grid;
  width: 100%;
  max-width: 18rem;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.35rem;
}

.image-composer__dimension {
  display: flex;
  height: 2.05rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(231 231 228);
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  padding: 0 0.55rem;
  color: rgb(113 113 107);
  font-size: 0.67rem;
}

.image-composer__dimension input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgb(31 31 30);
  font-size: 0.76rem;
  font-weight: 500;
  outline: none;
}

.image-composer__dimension-x {
  color: rgb(142 142 136);
  font-size: 0.7rem;
}

.image-composer__custom-size-help {
  color: rgb(142 142 136);
  font-size: 0.64rem;
  line-height: 1.55;
}

.image-composer__custom-size-summary {
  color: rgb(54 54 51);
  font-size: 0.68rem;
  line-height: 1.45;
}

.image-composer__custom-size-error {
  border-radius: 0.5rem;
  background: rgb(255 243 237);
  padding: 0.35rem 0.5rem;
  color: rgb(194 65 12);
  font-size: 0.66rem;
  line-height: 1.45;
}

.image-composer__label {
  color: rgb(42 42 40);
  font-size: 0.78rem;
  font-weight: 600;
}

.image-composer__text-action {
  min-height: 2.35rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  padding: 0 0.45rem;
  color: rgb(90 90 86);
  font-size: 0.8rem;
  white-space: nowrap;
}

.image-composer__text-action:hover {
  color: rgb(24 24 23);
  text-decoration: underline;
  text-underline-offset: 0.2rem;
}

.image-composer__segmented {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.15rem;
  overflow: hidden;
  border: 1px solid rgb(229 229 225);
  border-radius: 0.7rem;
  background: rgb(242 242 239);
  padding: 0.2rem;
}

.image-composer__segmented--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.image-composer__segmented button {
  min-height: 2rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: rgb(113 113 107);
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}

.image-composer__segmented button:hover {
  background: rgb(255 255 255 / 0.58);
  color: rgb(31 31 30);
}

.image-composer__segmented button.is-active {
  background: rgb(250 250 248);
  color: rgb(31 31 30);
  box-shadow:
    0 1px 2px rgb(24 24 27 / 0.12),
    0 0 0 1px rgb(24 24 27 / 0.04);
}

.image-composer__select-like {
  display: flex;
  width: 100%;
  min-height: 2.35rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid rgb(231 231 228);
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  padding: 0 0.8rem;
  color: rgb(54 54 51);
  font-size: 0.82rem;
  text-align: left;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.image-composer__select-like:hover {
  border-color: rgb(201 201 196);
  box-shadow: 0 4px 14px rgb(24 24 27 / 0.05);
}

.image-composer__footer {
  margin-top: 0.05rem;
  border-top: 1px solid rgb(239 239 236);
  padding-top: 0.7rem;
}

.image-composer__generate {
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

.image-composer__generate:hover:not(:disabled) {
  background: rgb(45 45 43);
}

.image-composer__generate:active:not(:disabled) {
  transform: translateY(1px);
}

.image-composer__generate:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.studio-results__actions {
  display: flex;
  min-width: 0;
  flex-shrink: 0;
  align-items: center;
  gap: 0.65rem;
}

.image-generation-status {
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

.image-generation-status .is-spinning {
  animation: studio-refresh-spin 0.8s linear infinite;
}

@media (max-width: 640px) {
  .image-generation-status span {
    display: none;
  }
}

@media (max-width: 900px) {
  .image-detail-dialog {
    grid-template-columns: minmax(0, 1fr);
  }

  .image-detail-dialog__media,
  .image-detail-dialog__panel {
    min-height: 0;
  }

  .image-detail-dialog__panel {
    max-height: 42vh;
  }
}

@media (max-width: 480px) {
  .image-composer {
    padding-right: 0.65rem;
    padding-left: 0.65rem;
  }

  .image-composer__option-grid.is-split {
    grid-template-columns: minmax(0, 1fr);
  }

  .image-composer__prompt {
    height: 7.75rem;
    min-height: 7.75rem;
    max-height: min(28rem, 60vh);
    padding: 0.75rem 0.8rem 0.2rem;
    font-size: 0.88rem;
  }

  .image-composer__prompt-footer {
    padding-right: 0.6rem;
    padding-left: 0.6rem;
  }

  .image-composer__model {
    min-width: 0;
    max-width: none;
  }

  .image-composer__prompt-actions button {
    height: 1.9rem;
    width: 1.9rem;
  }

  .image-composer__reference-grid {
    grid-template-columns: repeat(auto-fill, minmax(4.6rem, 1fr));
  }
}

.mini-action,
.secondary-button,
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(226 232 240);
  transition: all 0.18s ease;
}

.mini-action {
  width: 2rem;
  height: 2rem;
  background: rgb(255 255 255 / 0.9);
  color: rgb(71 85 105);
}

.mini-action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.mini-action .is-spinning {
  animation: studio-refresh-spin 0.8s linear infinite;
}

@keyframes studio-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.secondary-button {
  width: 2.25rem;
  height: 2.25rem;
  background: rgb(255 255 255 / 0.9);
  color: rgb(71 85 105);
}

.primary-button {
  min-height: 2.25rem;
  border-color: transparent;
  background: rgb(15 23 42);
  padding: 0 1rem;
  color: white;
  font-weight: 600;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.image-pending-card {
  position: absolute;
  inset: 0;
  display: flex;
  height: 100%;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  background: linear-gradient(135deg, rgb(241 245 249), rgb(226 232 240));
  color: rgb(51 65 85);
}

.image-pending-card small { color: rgb(100 116 139); }

.image-pending-card__timer {
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  color: rgb(13 148 136) !important;
}

.image-media-state {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  background: linear-gradient(135deg, rgb(241 245 249), rgb(226 232 240));
  padding: 1rem;
  text-align: center;
  color: rgb(51 65 85);
}

.image-media-state small {
  color: rgb(100 116 139);
}

.image-media-state--error {
  background: linear-gradient(135deg, rgb(254 242 242), rgb(241 245 249));
  color: rgb(185 28 28);
}

.image-media-state__retry {
  margin-top: 0.35rem;
  border: 1px solid rgb(248 113 113);
  border-radius: 0.45rem;
  padding: 0.3rem 0.75rem;
  color: rgb(185 28 28);
  font-size: 0.75rem;
  font-weight: 650;
}

.image-detail-dialog__media {
  position: relative;
}

.image-detail-dialog__media-state {
  border-radius: 0.75rem;
}

.image-generation-spinner {
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 auto;
  border: 3px solid rgb(13 148 136 / 0.2);
  border-top-color: rgb(13 148 136);
  border-radius: 999px;
  animation: image-generation-spin 0.8s linear infinite;
}

@keyframes image-generation-spin {
  to { transform: rotate(360deg); }
}

:global(.dark .toolbar-field),
:global(.dark .mini-action),
:global(.dark .secondary-button) {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27 / 0.9);
}

:global(.dark .image-media-state) {
  background: linear-gradient(135deg, rgb(39 39 42), rgb(24 24 27));
  color: rgb(228 228 231);
}

:global(.dark .image-media-state small) {
  color: rgb(161 161 170);
}

:global(.dark .image-media-state--error) {
  background: linear-gradient(135deg, rgb(69 26 26), rgb(39 39 42));
  color: rgb(252 165 165);
}

:global(.dark .image-media-state__retry) {
  border-color: rgb(248 113 113);
  color: rgb(254 202 202);
}

:global(.dark .toolbar-field--select) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  padding: 0 0.55rem;
}

:global(.dark .toolbar-field select),
:global(.dark .toolbar-field input),
:global(.dark .composer-field select),
:global(.dark .composer-field input) {
  color: rgb(244 244 245);
}

:global(.dark .composer-field select),
:global(.dark .composer-field input) {
  border-color: rgb(63 63 70);
  background: rgb(9 9 11);
}

:global(.dark .composer-size-trigger) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
  color: rgb(241 245 249);
}

:global(.dark .composer-size-trigger span) {
  color: rgb(148 163 184);
}

:global(.dark .composer-size-trigger strong) {
  color: rgb(241 245 249);
}

:global(.dark .composer-prompt-toggle) {
  border: 0;
  background: transparent;
  color: rgb(167 159 148);
}

:global(.dark .composer-prompt-toggle:hover) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .count-stepper) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
}

:global(.dark .count-stepper input) {
  border-color: rgb(51 65 85);
  color: rgb(241 245 249);
}

:global(.dark .size-dialog) {
  --soft-text: rgb(241 245 249);
  --soft-muted: rgb(148 163 184);
  --soft-line: rgb(51 65 85);
  --soft-panel: rgb(30 41 59);
  --soft-accent: rgb(45 212 191);
}

:global(.dark .size-tabs) {
  background: rgb(19 78 74 / 0.55);
}

:global(.dark .size-tab.active),
:global(.dark .size-base-option),
:global(.dark .size-ratio-option),
:global(.dark .size-custom-ratio-toggle),
:global(.dark .size-custom-ratio input),
:global(.dark .size-dimension-row input) {
  background: rgb(30 41 59);
  color: rgb(226 232 240);
}

:global(.dark .size-base-option.active),
:global(.dark .size-ratio-option.active),
:global(.dark .size-custom-ratio-toggle.active) {
  border-color: rgb(45 212 191 / 0.7);
  background: rgb(19 78 74 / 0.72);
  color: rgb(204 251 241);
  box-shadow: 0 6px 18px rgb(13 148 136 / 0.2);
}

:global(.dark .size-preview),
:global(.dark .size-dimension-hint),
:global(.dark .size-dialog__cancel) {
  background: rgb(30 41 59);
}

:global(.dark .size-dialog__current strong),
:global(.dark .size-dimension-hint) {
  color: rgb(226 232 240);
}

:global(.dark .size-dialog__issue) {
  background: rgb(69 26 3 / 0.6);
  color: rgb(253 230 138);
}

:global(.dark .size-auto-icon) {
  background: rgb(19 78 74 / 0.65);
}

:global(.dark .image-detail-dialog__panel) {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27);
}

:global(.dark .image-detail-dialog__media) {
  background: rgb(29 28 25);
}

:global(.dark .image-detail-dialog__section-head),
:global(.dark .image-detail-dialog__info dd) {
  color: rgb(244 244 245);
}

:global(.dark .image-detail-dialog__prompt-input) {
  border-color: rgb(63 63 70);
  background: rgb(38 38 36);
  color: rgb(244 244 245);
}

:global(.dark .image-detail-dialog__info) {
  border-color: rgb(63 63 70);
}

:global(.dark .image-detail-dialog__download),
:global(.dark .image-detail-dialog__save) {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27);
  color: rgb(226 232 240);
}

.image-studio .studio-page__header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 0.85rem;
}

.image-studio .studio-page__header h1 {
  font-size: 1.35rem;
  font-weight: 700;
  color: rgb(24 24 27);
}

.image-studio .studio-page__header p {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: rgb(113 113 122);
}

.image-studio .studio-page__header > .flex {
  align-items: stretch;
}

.image-studio .studio-page__composer {
  padding: 0 1rem 1rem;
}

.image-results-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: start;
  gap: 1rem;
}

.image-result-card__media {
  aspect-ratio: 16 / 10;
}

.image-result-card__media img {
  width: 100%;
  height: 100%;
}

.image-studio .studio-page__results article {
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.03);
}

.image-studio .studio-page__results article > button {
  background: rgb(250 250 249);
}

.image-studio .studio-results__body > .flex:first-child {
  min-height: 100%;
}

@media (max-width: 1024px) {
  .image-results-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .image-studio .studio-page__header {
    padding-bottom: 1rem;
  }
}

@media (max-width: 820px) {
  .image-results-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .image-results-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

:global(.dark .image-studio .studio-page__header h1) {
  color: rgb(244 244 245);
}

:global(.dark .image-studio .studio-page__results article) {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27);
}

:global(.dark .image-composer) {
  background: rgb(24 24 27);
}

:global(.dark .image-composer__prompt-shell) {
  border-color: rgb(54 54 51);
  background: rgb(35 35 33);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04);
}

:global(.dark .image-composer__prompt-shell:focus-within) {
  border-color: rgb(82 82 76);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.24);
}

:global(.dark .image-composer__prompt) {
  color: rgb(244 244 242);
}

:global(.dark .image-composer__model .studio-select__trigger) {
  border-color: rgb(64 64 60) !important;
  background: rgb(46 46 43) !important;
  color: rgb(239 239 235) !important;
}

:global(.dark .image-composer__model .studio-select__trigger span) {
  color: rgb(239 239 235) !important;
}

:global(.dark .image-composer__prompt-actions button),
:global(.dark .image-composer__section-head button) {
  color: rgb(188 188 181);
}

:global(.dark .image-composer__prompt-actions button:hover),
:global(.dark .image-composer__section-head button:hover) {
  background: rgb(48 48 45);
  color: rgb(247 247 243);
}

:global(.dark .image-composer__section-head),
:global(.dark .image-composer__toggle-row),
:global(.dark .image-composer__label) {
  color: rgb(236 236 232);
}

:global(.dark .image-composer__reference) {
  border-color: rgb(62 62 58);
  background: rgb(38 38 36);
}

:global(.dark .image-composer__upload-tile),
:global(.dark .image-composer__select-like),
:global(.dark .image-composer__dimension) {
  border-color: rgb(70 70 65);
  background: rgb(38 38 36);
  color: rgb(232 232 227);
}

:global(.dark .image-composer__upload-tile:hover),
:global(.dark .image-composer__select-like:hover) {
  border-color: rgb(98 98 91);
  background: rgb(44 44 41);
}

:global(.dark .image-composer__helper) {
  color: rgb(151 151 144);
}

:global(.dark .image-composer__size-menu) {
  border-color: rgb(70 70 65);
  background: rgb(35 35 33);
}

:global(.dark .image-composer__size-option) {
  color: rgb(229 229 224);
}

:global(.dark .image-composer__size-option:hover) {
  background: rgb(47 47 44);
}

:global(.dark .image-composer__size-option.is-active) {
  background: rgb(58 58 54);
  color: rgb(250 250 247);
}

:global(.dark .image-composer__size-option-note),
:global(.dark .image-composer__size-group),
:global(.dark .image-composer__custom-size-help),
:global(.dark .image-composer__dimension-x) {
  color: rgb(151 151 144);
}

:global(.dark .image-composer__custom-size) {
  border-color: rgb(54 54 51);
}

:global(.dark .image-composer__custom-size-toggle),
:global(.dark .image-composer__custom-size-summary) {
  color: rgb(226 226 221);
}

:global(.dark .image-composer__dimension input) {
  color: rgb(244 244 241);
}

:global(.dark .image-composer__custom-size-error) {
  background: rgb(67 30 15);
  color: rgb(253 186 116);
}

:global(.dark .image-composer__text-action) {
  color: rgb(185 185 178);
}

:global(.dark .image-composer__text-action:hover) {
  color: rgb(247 247 243);
}

:global(.dark .image-composer__segmented) {
  border-color: rgb(64 64 60);
  background: rgb(41 41 38);
}

:global(.dark .image-composer__segmented button) {
  color: rgb(168 168 161);
}

:global(.dark .image-composer__segmented button:hover) {
  background: rgb(255 255 255 / 0.06);
  color: rgb(238 238 234);
}

:global(.dark .image-composer__segmented button.is-active) {
  background: rgb(241 241 237);
  color: rgb(30 30 28);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.28);
}

:global(.dark .image-composer__option-note) {
  color: rgb(151 151 144);
}

:global(.dark .image-composer__footer) {
  border-color: rgb(54 54 51);
}

:global(.dark .image-composer__generate) {
  background: rgb(244 244 241);
  color: rgb(24 24 23);
}

:global(.dark .image-composer__generate:hover:not(:disabled)) {
  background: rgb(226 226 221);
}

:global(.dark .image-generation-status) {
  background: rgb(19 78 74 / 0.45);
  color: rgb(153 246 228);
}
</style>
