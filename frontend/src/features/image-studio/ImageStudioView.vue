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
            <button type="button" class="studio-results__action" :disabled="refreshing" @click="loadGallery()">
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
            class="image-result-card group overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-dark-700 dark:bg-dark-800"
          >
            <button
              type="button"
              class="image-result-card__media relative block w-full overflow-hidden"
              :disabled="!canOpenImagePreview(image)"
              @click="canOpenImagePreview(image) && (previewImage = image)"
              @contextmenu.prevent.stop="openImageDownloadMenu($event, image)"
            >
              <div
                v-if="image.pending"
                class="image-pending-card"
                :class="{ 'image-pending-card--preview': image.previewSrc }"
              >
                <template v-if="image.previewSrc">
                  <img
                    :src="image.previewSrc"
                    :alt="image.title"
                    class="image-pending-card__preview"
                    decoding="async"
                    @load="reportImageDisplay(image)"
                  />
                  <div class="image-pending-card__preview-status">
                    <span class="image-generation-spinner" aria-hidden="true"></span>
                    <strong>预览已生成</strong>
                    <small>正在后台保存原图</small>
                  </div>
                </template>
                <template v-else>
                  <span class="image-generation-spinner" aria-hidden="true"></span>
                  <strong>正在生成</strong>
                  <small>最多等待 10 分钟，超时后会直接停止</small>
                  <small class="image-pending-card__timer" data-testid="image-pending-timer">
                    {{ pendingElapsedSeconds(image) }} 秒
                  </small>
                </template>
              </div>
              <div v-else-if="image.failed" class="image-failure-card" data-testid="image-generation-failure">
                <strong>生成失败</strong>
                <p>{{ image.error || '生成失败，请重试' }}</p>
                <small v-if="image.prompt">{{ image.prompt }}</small>
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
                  v-if="!isImageMediaFailed(image) && imageMediaDisplaySrc(image)"
                  :key="imageMediaRenderKey(image)"
                  :src="imageMediaDisplaySrc(image)"
                  :srcset="isAnimatedImage(image) ? undefined : image.thumbSrcSet"
                  :ref="(element) => bindImageMediaElement(image, element)"
                  :alt="image.title"
                  :loading="image.gatewayTaskId ? 'eager' : 'lazy'"
                  decoding="async"
                  class="absolute inset-0 block h-full w-full object-cover"
                  :class="{ 'opacity-0': !isImageMediaLoaded(image) }"
                  @load="markImageMediaLoaded(image)"
                  @error="handleImageMediaError(image)"
                />
              </template>
              <span
                v-if="!image.pending && !image.failed && isShowingThumbnail(image)"
                class="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm"
                data-testid="image-thumbnail-badge"
              >
                缩略图预览
              </span>
            </button>
              <div class="image-result-card__footer flex items-center justify-between gap-2 px-3 py-2">
                <div class="min-w-0">
                  <p class="truncate text-[11px] text-gray-400">
                    {{ image.createdAt ? `${formatCreatedAt(image.createdAt)} · ${image.meta}` : image.meta }}
                  </p>
                  <p
                    v-if="!image.pending && !image.failed && image.saved"
                    class="text-xs text-emerald-600 dark:text-emerald-400"
                    data-testid="image-saved-badge"
                  >
                    已保存到我的作品
                  </p>
                  <p
                    v-else-if="!image.pending && !image.failed && image.expiresAt"
                    class="text-xs text-amber-600 dark:text-amber-400"
                    data-testid="image-temp-badge"
                  >
                    {{ remainingDays(image) > 0 ? `临时内容 · 还剩 ${remainingDays(image)} 天` : '临时内容 · 已过期' }}
                  </p>
                </div>
                <div v-if="!image.pending && !image.failed" class="flex shrink-0 gap-1">
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
                  <button
                    type="button"
                    class="mini-action"
                    title="下载图片"
                    data-testid="gallery-image-download"
                    :disabled="isImageDownloading(image)"
                    :aria-busy="isImageDownloading(image)"
                    @click="downloadImage(image)"
                  >
                    <Icon
                      :name="isImageDownloading(image) ? 'refresh' : 'download'"
                      size="sm"
                      :class="{ 'animate-spin': isImageDownloading(image) }"
                    />
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
                <div v-else-if="image.failed" class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    class="image-failure-retry"
                    data-testid="image-retry-generation"
                    :disabled="isFailedImageRetrying(image)"
                    @click="retryFailedImage(image)"
                  >
                    <Icon name="refresh" size="sm" :class="{ 'is-spinning': isFailedImageRetrying(image) }" />
                    <span>{{ isFailedImageRetrying(image) ? '重试中' : '重试' }}</span>
                  </button>
                  <button
                    type="button"
                    class="mini-action"
                    title="删除失败记录"
                    @click="removeFailedImage(image)"
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
            data-testid="image-prompt-input"
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
          <p class="image-composer__helper" data-testid="image-reference-limit-hint">
            可拖拽或粘贴参考图，当前模型最多 {{ effectiveReferenceLimit }} 张。点击图片编号可把「图片1」等引用插入提示词。
          </p>
          <p
            v-if="referenceLimitIssue"
            class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
            data-testid="image-reference-limit-warning"
          >
            {{ referenceLimitIssue }}
          </p>
          <p
            v-if="modelQualityIssue"
            class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
            data-testid="image-model-quality-warning"
          >
            {{ modelQualityIssue }}
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
              class="image-composer__segmented"
              :class="formatOptions.length > 3 ? 'image-composer__segmented--four' : 'image-composer__segmented--three'"
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
            {{ hasActiveImageGeneration ? '继续生成' : '开始生成' }}
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
            :class="{
              'image-media-state--error': isImageMediaFailed(previewImage),
              'image-detail-dialog__media-state--inline': !isImageMediaFailed(previewImage),
            }"
            :data-testid="isImageMediaFailed(previewImage) ? 'preview-image-error' : 'preview-image-loading'"
          >
            <span v-if="!isImageMediaFailed(previewImage)" class="image-generation-spinner" aria-hidden="true"></span>
            <strong>{{ isImageMediaFailed(previewImage) ? '图片加载失败' : '图片加载中' }}</strong>
            <small>
              {{
                isImageMediaFailed(previewImage)
                  ? '原图暂时无法加载'
                  : previewImage.thumbSrc
                    ? '已显示预览，正在加载高清原图'
                    : '正在加载高清图片'
              }}
            </small>
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
            decoding="async"
            @load="markImageMediaLoaded(previewImage)"
            @error="handleImageMediaError(previewImage)"
            @contextmenu.prevent.stop="openImageDownloadMenu($event, previewImage)"
          />
          <span
            v-if="isPreviewShowingThumbnail(previewImage)"
            class="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm"
            data-testid="preview-thumbnail-badge"
          >
            缩略图预览
          </span>
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
            :disabled="savingPreviewImage || previewImage.pending"
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
          <button
            type="button"
            class="image-detail-dialog__download"
            :disabled="Boolean(previewImage && isImageDownloading(previewImage))"
            @click="previewImage && downloadImage(previewImage)"
          >
            <Icon
              :name="previewImage && isImageDownloading(previewImage) ? 'refresh' : 'download'"
              size="sm"
              :class="{ 'animate-spin': previewImage && isImageDownloading(previewImage) }"
            />
            <span>{{ previewImage && isImageDownloading(previewImage) ? '下载中…' : '下载图片' }}</span>
          </button>
        </div>
      </template>
    </BaseDialog>

    <div
      v-if="imageDownloadMenu"
      class="fixed z-[100] w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-2xl dark:border-dark-700 dark:bg-dark-800"
      :style="{ left: `${imageDownloadMenu.x}px`, top: `${imageDownloadMenu.y}px` }"
      data-testid="image-context-menu"
      @pointerdown.stop
    >
      <div class="px-3 py-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
        {{ isPreviewShowingThumbnail(imageDownloadMenu.image) || isShowingThumbnail(imageDownloadMenu.image) ? '缩略图预览' : '图片操作' }}
      </div>
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-dark-700"
        data-testid="download-original-image"
        :disabled="isImageDownloading(imageDownloadMenu.image)"
        @click="downloadOriginalFromMenu"
      >
        <Icon name="download" size="sm" />
        <span>下载原图（高清）</span>
      </button>
    </div>

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
import { IMAGE_STUDIO_DEFAULT_PROMPT, imageStudioDraft, resetImageStudioDraft } from './imageStudioDraft'
import {
  normalizeStudioDisplayOrder,
  sortStudioItemsByDisplayOrder,
} from '@/features/studioDisplayOrder'
import {
  IMAGE_STUDIO_GALLERY_CHANGED_EVENT,
} from './galleryEvents'
import {
  imageNeedsLocalResize,
  LOCAL_IMAGE_MAX_EDGE,
  processImageForDisplay,
} from './imagePostProcess'
import {
  prepareImageReferenceImages,
  type PreparedImageReference,
} from '@/utils/imageReferenceCompression'
import { resolveGeminiImageModelPolicy, type GeminiImageQuality } from './geminiImageModelPolicy'
import { createReferenceImagePreview } from './referenceImagePreview'
import { imageDownloadURL, resolveImageAssetURL } from './imageDownload'
import {
  buildEditForm,
  buildEditURLPayload,
  buildGeminiPayload,
  buildGeminiURL,
  extractImages,
  greatestCommonDivisor,
} from './imageRequestBuilder'
import {
  formatImageStudioErrorMessage,
  isImageStorageConfigError,
  nestedErrorStatus,
} from './imageStudioErrors'
import {
  IMAGE_CONSTRAINTS,
  clampImageDimension,
  fitImageSizeToWindow,
  normalizeImageDimension,
  parseImageSizeValue,
  validateImageSize,
} from './imageSizeConstraints'
import {
  isAnimatedImageSource,
  resolveExplicitImageMediaSource,
  resolveImageMediaSource,
} from './imageMediaState'
import {
  deduplicateImageModelNames as deduplicateModelNames,
  isGeminiImageModelName as isGeminiModel,
  isGrokImageModelName,
  isImageModelName as isImageModel,
} from './imageModelPolicy'
import {
  isImageTaskActive,
  isImageTaskDisplayReady,
} from './imageTaskState'
import {
  gatewayPollUrlForTask,
  gatewayTaskPayload,
} from './imageTaskTransport'
import {
  ImageGatewayTaskError,
  fetchWithTimeout,
  gatewayAsyncSubmitUrl,
  gatewayTaskError,
  isTransientGatewayError,
  isTransientGatewayStatus,
  lookupGatewayTaskByIdempotency,
  pollGatewayImageTask as pollGatewayImageTaskFromClient,
} from './imageTaskClient'
import {
  sameImageIdentityOrder,
  sameStoredObject,
  stableDisplayOrder,
} from './imageGalleryState'
import {
  PENDING_PROMPT_STORAGE_KEY,
  PENDING_STORAGE_KEY,
  failedImageStorageKey,
  pendingImageStorageKey,
  pendingPromptStorageKey,
  readStudioPreferences as readStoredStudioPreferences,
  readStudioSnapshot as readStoredStudioSnapshot,
  writeStudioPreferences as writeStoredStudioPreferences,
  writeStudioSnapshot as writeStoredStudioSnapshot,
  type ImageStudioSnapshot,
} from './imageStudioPersistence'
import {
  allocateImageBatchDisplayOrder as allocateImageQueueDisplayOrder,
  createPendingImageBatch,
  failImageTask,
  normalizeImageRequestCount,
  removePendingTaskImages,
} from './imageGenerationQueue'
import type {
  GeneratedImage,
  GenerationRequestSnapshot,
  ReferenceItem,
  SizeSettings,
} from './imageStudioTypes'
import Icon from '@/components/icons/Icon.vue'
import { useClipboard } from '@/composables/useClipboard'
import {
  createImageGenerationTaskId,
  ImageGenerationStillRunning,
  ImageGenerationWaitCancelled,
  tryStartPersistentImageGeneration,
  waitForPersistentImageGeneration,
  type ImageGenerationWorkerResponse,
} from '@/utils/imageGenerationWorker'
import { usePromptResize } from '@/composables/usePromptResize'
import { ensureCreatorKey, isCreationServiceUnavailable } from '@/composables/useCreatorKey'
import { authAPI, imageStudioGalleryAPI, type ImageStudioGalleryEntry } from '@/api'
import { referenceAssetsAPI } from '@/api/referenceAssets'
import type { ApiKey } from '@/types'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'
import { notifyCreatorKeyChanged } from '@/utils/creatorKeyEvents'

const IMAGE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000
const IMAGE_ASYNC_SUBMIT_TIMEOUT_MS = 8 * 60 * 1000
const IMAGE_GENERATION_TIMEOUT_MESSAGE = '图片生成超过 10 分钟，已停止等待，请重新生成'
const IMAGE_MEDIA_LOAD_TIMEOUT_MS = 10_000
const GALLERY_URL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
const reportedGenerationFailures = new Set<string>()
const reportedVisibleErrors = new Set<string>()

class ImageSubmissionUnconfirmed extends Error {
  constructor(message = '图片任务提交状态暂无法确认，正在等待网络恢复') {
    super(message)
    this.name = 'ImageSubmissionUnconfirmed'
  }
}

type GenerationResultHandler = (
  image: GeneratedImage,
  result: PromiseSettledResult<any[]>,
) => Promise<void> | void

const keys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const apiBaseUrl = ref('')
const imageModel = ref('')
const imageModels = ref<string[]>([])
const loadingModels = ref(false)
const refreshing = ref(false)
const modelLoadError = ref('')
const prompt = ref(IMAGE_STUDIO_DEFAULT_PROMPT)
const lastSubmittedPrompt = ref('')
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
watch(errorMessage, (message) => {
  const normalized = message.trim()
  if (!normalized) return
  reportVisibleImageStudioError(normalized)
})
const images = ref<GeneratedImage[]>([])
const generationPrompt = computed(() => (
  prompt.value.trim()
  || lastSubmittedPrompt.value.trim()
  || images.value.find((image) => image.prompt?.trim())?.prompt?.trim()
  || ''
))
const generationClockNow = ref(Date.now())
const activeImageTaskCount = computed(() => images.value.filter(isImageTaskActive).length)
const keyCredentialsReady = ref(false)
const references = ref<ReferenceItem[]>([])
const generationRequestSnapshots = new Map<string, GenerationRequestSnapshot>()
const retryingFailureIds = ref<Set<string>>(new Set())
const previewImage = ref<GeneratedImage | null>(null)
const previewDisplaySrc = ref('')
const imageDownloadMenu = ref<{ x: number; y: number; image: GeneratedImage } | null>(null)
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
const studioStateOwnerId = ref(String(authStore.user?.id || ''))
let studioUserEpoch = 0

type StudioOwnerSnapshot = {
  epoch: number
  userId: string
}

function captureStudioOwner(): StudioOwnerSnapshot {
  return {
    epoch: studioUserEpoch,
    userId: studioStateOwnerId.value,
  }
}

function isStudioOwnerCurrent(owner: StudioOwnerSnapshot) {
  return owner.epoch === studioUserEpoch && owner.userId === studioStateOwnerId.value
}

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

let nextImageId = 1
let imageDisplayOrderCursor = Date.now() * 1000

function imageDisplayOrder(image: GeneratedImage) {
  return normalizeStudioDisplayOrder(image.displayOrder)
    || normalizeStudioDisplayOrder(image.createdAt)
}

function mergeImagesByDisplayOrder(
  current: GeneratedImage[],
  incoming: GeneratedImage[],
): GeneratedImage[] {
  const seen = new Set<string>()
  const merged = [...incoming, ...current].filter((image) => {
    const key = String(image.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return sortStudioItemsByDisplayOrder(merged)
}

function restoreStudioSnapshot(userId?: number | string) {
  if (userId == null) return
  const snapshot = readStoredStudioSnapshot(sessionStorage, userId)
  if (!snapshot) return
  keys.value = snapshot.keys.map((key) => ({ ...key, key: '' }))
  selectedKeyId.value = snapshot.selectedKeyId
  imageModels.value = snapshot.imageModels
  imageModel.value = snapshot.imageModel
  images.value = sortStudioItemsByDisplayOrder(snapshot.images.map((image) => ({
    ...image,
    restoredFromSnapshot: true,
  })))
  const numericIds = images.value
    .map((image) => Number(image.id))
    .filter((id) => Number.isFinite(id) && id > 0)
  if (numericIds.length) {
    nextImageId = Math.max(nextImageId, ...numericIds.map((id) => id + 1))
  }
  imageDisplayOrderCursor = Math.max(
    imageDisplayOrderCursor,
    ...images.value.map((image) => imageDisplayOrder(image)),
  )
}

function writeStudioSnapshot(userId: number | string | null | undefined = authStore.user?.id) {
  try {
    if (userId == null) return
    const snapshot: ImageStudioSnapshot = {
      keys: keys.value.map((key) => ({ ...key, key: '' })),
      selectedKeyId: selectedKeyId.value,
      imageModels: imageModels.value,
      imageModel: imageModel.value,
      images: images.value
        .filter((image) => !image.pending && image.src && !image.src.startsWith('data:'))
        .slice(0, 48)
        .map((image, index) => ({
          ...image,
          originalSrc: undefined,
          thumbSrcSet: undefined,
          // Inline previews keep recent cards instant after a refresh. Bound
          // how many are persisted so sessionStorage quota is not exhausted.
          thumbSrc: isInlineImageSource(image.thumbSrc)
            ? (index < 6 ? image.thumbSrc : undefined)
            : image.thumbSrc,
        })),
    }
    writeStoredStudioSnapshot(sessionStorage, userId, snapshot)
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
    : validateImageSize(size.value)
))
const sizeDisplayLabel = computed(() => {
  if (appliedSize.mode === 'auto') return '自动（由模型决定）'
  if (appliedSize.mode === 'ratio' && isGrokImageModel.value) {
    return `${grokResolutionForBase(appliedSize.aspectBase)} · ${appliedSize.aspectRatio}`
  }
  if (appliedSize.mode === 'ratio') return `${appliedSize.aspectRatio} ${size.value}`
  const dimensions = parseImageSizeValue(size.value)
  if (!dimensions) return size.value
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height)
  return `${dimensions.width / divisor}:${dimensions.height / divisor} ${size.value}`
})
const snapTo16Enabled = computed({
  get: () => snapTo16.value,
  set: (value: boolean) => {
    snapTo16.value = value
    if (!value) return
    appliedSize.width = normalizeImageDimension(appliedSize.width, maxImageEdge.value)
    appliedSize.height = normalizeImageDimension(appliedSize.height, maxImageEdge.value)
  },
})
const customSizeSummary = computed(() => {
  const dimensions = parseImageSizeValue(size.value)
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
  { value: 1024, label: '1K' },
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
const baseFormatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WEBP' },
]
const gifFormatOption = { value: 'gif', label: 'GIF' }
const imageFormatValues = new Set([...baseFormatOptions.map((option) => option.value), gifFormatOption.value])
const supportsGifOutput = computed(() => imageModel.value.toLowerCase().includes('gpt-image-2-6'))
const formatOptions = computed(() => (
  supportsGifOutput.value ? [...baseFormatOptions, gifFormatOption] : baseFormatOptions
))
watch(supportsGifOutput, (supported) => {
  if (!supported && format.value === gifFormatOption.value) {
    format.value = 'png'
  }
})
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
const isGeminiImageModel = computed(() => isGeminiModel(imageModel.value))
const geminiModelPolicy = computed(() => resolveGeminiImageModelPolicy(imageModel.value))
const effectiveReferenceLimit = computed(() => geminiModelPolicy.value.maxReferences)
const referenceLimitIssue = computed(() => (
  references.value.length > effectiveReferenceLimit.value
    ? `当前模型最多 ${effectiveReferenceLimit.value} 张参考图，已选择 ${references.value.length} 张，请移除 ${references.value.length - effectiveReferenceLimit.value} 张。`
    : ''
))
const modelQualityIssue = computed(() => (
  isGeminiImageModel.value && !geminiModelPolicy.value.allowedQualities.includes(quality.value as GeminiImageQuality)
    ? geminiModelPolicy.value.notice
    : ''
))
const hasActiveImageGeneration = computed(() => (
  generating.value
  || activeGenerations.value > 0
  || activeImageTaskCount.value > 0
))
const canGenerate = computed(() => Boolean(apiBaseUrl.value && selectedKey.value?.key && imageModel.value.trim() && generationPrompt.value)
  && !sizeIssue.value
  && !referenceLimitIssue.value
  && !modelQualityIssue.value)
const isGptImageModel = computed(() => imageModel.value.toLowerCase().includes('gpt-image'))
const isGrokImageModel = computed(() => isGrokImageModelName(imageModel.value))
const maxImageEdge = computed(() => (
  isGeminiImageModel.value ? LOCAL_IMAGE_MAX_EDGE : IMAGE_CONSTRAINTS.maxEdge
))
const modelSupportsTransparentBackground = computed(() => (
  !isGeminiImageModel.value && !isGrokImageModel.value
))
const geminiQualityOptions = [
  { value: 'auto', label: '自动' },
  { value: 'high', label: '4K' },
  { value: 'medium', label: '2K' },
  { value: 'low', label: '1K' },
] as const
const qualityDisplayOptions = computed(() => isGeminiImageModel.value
  ? geminiQualityOptions.filter((option) => geminiModelPolicy.value.allowedQualities.includes(option.value))
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
  selectedKey.value?.key,
))
// 本会话里已保存进图库的条目 id：这些图本地已有可显示的副本，
// 图库列表里再渲染一次就会出现"生成一张却显示两张"的重复卡片。
const locallySavedGalleryIds = new Set<string>()
const downloadingImageIds = ref(new Set<string>())
// 已经在服务端有记录的图片 id：只有这些能删（本地刚生成还没存进图库的删不了）。
const galleryBackedIds = ref<Set<string>>(new Set())
// 本会话刚保存进图库的图片，卡片上还是本地数字 id；映射到图库 id 才能立刻删掉，
// 不用等刷新页面。
const localToGalleryId = ref<Map<string, string>>(new Map())
// 刚生成图片的入库任务。下载要等它拿到服务端作品 id，才能直接签发 R2 下载地址。
const pendingGalleryImageIds = new Map<string, Promise<string>>()
const galleryRemoteThumbUrls = new Map<string, string>()
const galleryThumbnailDataUrls = new Map<string, string>()
const galleryThumbnailRecoveryIds = new Set<string>()
const GALLERY_THUMBNAIL_CONCURRENCY = 4
const scheduledGalleryThumbnailLoads = new Map<string, Promise<void>>()
const queuedGalleryThumbnailLoads: Array<() => void> = []
let activeGalleryThumbnailLoads = 0
let galleryThumbnailEpoch = 0
const imageMediaTimeoutIds = new Map<string, ReturnType<typeof setTimeout>>()
const imageProcessingTasks = new Map<string, Promise<void>>()
const IMAGE_DISPLAY_PROCESSING_FALLBACK_MS = IMAGE_MEDIA_LOAD_TIMEOUT_MS
interface PendingImageDisplayProcessing {
  image: GeneratedImage
  source: string
  targetSize: string
  targetFormat: string
  owner?: StudioOwnerSnapshot
  resolve: () => void
  onError: (error: string) => void
}
const pendingImageDisplayProcessing = new Map<string, PendingImageDisplayProcessing>()
const imageDisplayProcessingFallbackTimers = new Map<string, number>()
const studioQuota = ref<{ used: number; limit: number } | null>(null)
const resumedGenerationBatches = new Set<string>()
const resumedGatewayBatches = new Set<string>()
const resumingAmbiguousTaskIDs = new Set<string>()

function clearStudioUserState() {
  studioUserEpoch += 1
  referenceAddEpoch += 1
  if (previewImage.value) previewImage.value = null
  previewDisplaySrc.value = ''
  imageDownloadMenu.value = null
  images.value = []
  keys.value = []
  selectedKeyId.value = ''
  imageModels.value = []
  imageModel.value = ''
  apiBaseUrl.value = ''
  loadingModels.value = false
  refreshing.value = false
  modelLoadError.value = ''
  errorMessage.value = ''
  keyCredentialsReady.value = false
  generating.value = false
  activeGenerations.value = 0
  modelRequestId += 1
  studioQuota.value = null
  loadedImageMediaIds.value.clear()
  failedImageMediaIds.value.clear()
  imageMediaRetryNonce.value.clear()
  for (const timer of imageMediaTimeoutIds.values()) clearTimeout(timer)
  imageMediaTimeoutIds.clear()
  cancelPendingImageDisplayProcessing()
  locallySavedGalleryIds.clear()
  galleryBackedIds.value.clear()
  localToGalleryId.value.clear()
  pendingGalleryImageIds.clear()
  galleryRemoteThumbUrls.clear()
  galleryThumbnailDataUrls.clear()
  galleryThumbnailRecoveryIds.clear()
  galleryThumbnailEpoch += 1
  scheduledGalleryThumbnailLoads.clear()
  queuedGalleryThumbnailLoads.splice(0)
  resumedGenerationBatches.clear()
  resumedGatewayBatches.clear()
  resumingAmbiguousTaskIDs.clear()
  pendingDeleteImage.value = null
  deletingImage.value = false
  savingPreviewImage.value = false
  previewPromptDraft.value = ''
  resetImageStudioDraft()
  prompt.value = IMAGE_STUDIO_DEFAULT_PROMPT
  lastSubmittedPrompt.value = ''
  references.value = []
  generationRequestSnapshots.clear()
  retryingFailureIds.value.clear()
  nextImageId = 1
}

async function switchStudioUser(userId?: number | string | null) {
  const nextUserId = userId == null ? '' : String(userId)
  if (nextUserId === studioStateOwnerId.value) return
  if (studioStateOwnerId.value) writeStudioSnapshot(studioStateOwnerId.value)
  clearStudioUserState()
  studioStateOwnerId.value = nextUserId
  if (!nextUserId) return
  restoreStudioSnapshot(nextUserId)
  await loadData()
}
let componentDisposed = false
let studioLoadedOnce = false
let nextReferenceId = Math.max(1, ...references.value.map((item) => item.id + 1))
let referenceAddEpoch = 0
let referenceAddQueue: Promise<void> = Promise.resolve()
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
  if (event.key !== 'Escape') return
  sizeMenuOpen.value = false
  imageDownloadMenu.value = null
}

function toggleCustomSize() {
  customSizeOpen.value = !customSizeOpen.value
  sizeMenuOpen.value = false
  if (!customSizeOpen.value) return
  const dimensions = parseImageSizeValue(size.value)
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
  if (isGeminiImageModel.value || isGptImageModel.value) {
    quality.value = qualityForAspectBase(base)
  }
  sizeMenuOpen.value = false
  customSizeOpen.value = false
}

function selectQuality(value: string) {
  quality.value = value
  if (!isGeminiImageModel.value && !isGptImageModel.value) return
  const base = aspectBaseForQuality(value)
  if (!base) return
  appliedSize.mode = 'ratio'
  appliedSize.useCustomRatio = false
  appliedSize.aspectBase = base
  if (isGptImageModel.value && !gptBaseDimensions[appliedSize.aspectRatio]) {
    appliedSize.aspectRatio = '1:1'
  }
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
    appliedSize.aspectBase = aspectBaseForQuality(quality.value) || 1024
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

function aspectBaseForQuality(value: string) {
  if (value === 'high') return 3840
  if (value === 'medium') return 2048
  if (value === 'low') return 1024
  return 0
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
  const fitted = fitImageSizeToWindow(dimensions[0] * scale, dimensions[1] * scale)
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
    const formatDimension = snapTo16.value
      ? (value: number) => normalizeImageDimension(value, maxImageEdge.value)
      : (value: number) => clampImageDimension(value, maxImageEdge.value)
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
  const fitted = fitImageSizeToWindow(width, height)
  return `${fitted.width}x${fitted.height}`
}

function formatDimensions(width: number, height: number) {
  return `${normalizeImageDimension(width, maxImageEdge.value)}x${normalizeImageDimension(height, maxImageEdge.value)}`
}

async function loadKeysAndSettings(epoch = studioUserEpoch, ownerId = studioStateOwnerId.value) {
  const isCurrentUser = () => epoch === studioUserEpoch && ownerId === studioStateOwnerId.value
  const keysPromise = ensureCreatorKey('image')
    .then((result) => {
      if (!isCurrentUser()) return
      keys.value = result.keys
      const preferences = readStoredStudioPreferences(localStorage, authStore.user?.id)
      const preferredKey = result.keys.find((key) => (
        String(key.id) === preferences.keyId
        && key.status === 'active'
        && key.group?.allow_image_generation !== false
      ))
      selectedKeyId.value = String(preferredKey?.id ?? result.key.id)
      keyCredentialsReady.value = true
    })
    .catch((error) => {
      if (!isCurrentUser()) return
      keyCredentialsReady.value = true
      if (!isCreationServiceUnavailable(error)) {
        errorMessage.value = errorMessageFrom(error, '图片创作服务暂不可用')
      }
    })
  const settingsPromise = authAPI.getPublicSettings()
    .then((settings) => {
      if (!isCurrentUser()) return
      apiBaseUrl.value = resolveEndpoint(settings.api_base_url || '')
    })
    .catch((error) => {
      if (!isCurrentUser()) return
      if (!errorMessage.value) errorMessage.value = errorMessageFrom(error, '加载设置失败')
    })

  await Promise.allSettled([keysPromise, settingsPromise])
}

async function loadData(epoch = studioUserEpoch, ownerId = studioStateOwnerId.value) {
  if (epoch !== studioUserEpoch || ownerId !== studioStateOwnerId.value) return
  errorMessage.value = ''
  restorePendingImages()
  restoreFailedImages()
  await Promise.allSettled([
    loadKeysAndSettings(epoch, ownerId),
    loadGallery(epoch, ownerId),
    loadStudioQuota(epoch, ownerId),
  ])
  if (epoch !== studioUserEpoch || ownerId !== studioStateOwnerId.value) return
  studioLoadedOnce = true
  void resumeAmbiguousGatewaySubmissions(
    images.value.filter((item) => item.pending && item.gatewaySubmitPending && !item.gatewayPollUrl),
  )
  void resumeGatewayGeneration(images.value.filter((item) => item.pending && item.gatewayPollUrl))
}

function refreshGalleryAfterExternalChange() {
  if (componentDisposed) return
  if (hasActiveImageGeneration.value) {
    galleryRefreshDeferred = true
    return
  }
  void Promise.allSettled([loadGallery(), loadStudioQuota()])
}

async function loadGallery(epoch = studioUserEpoch, ownerId = studioStateOwnerId.value) {
  try {
    const entries = await imageStudioGalleryAPI.list()
    if (epoch !== studioUserEpoch || ownerId !== studioStateOwnerId.value) return
    const entryById = new Map(entries.map((entry) => [String(entry.id), entry]))
    const matchedGalleryIds = new Set<string>()
    for (const entry of entries) {
      if (entry?.id) galleryBackedIds.value.add(String(entry.id))
      if (entry?.id && entry.thumb_url) {
        galleryRemoteThumbUrls.set(String(entry.id), String(entry.thumb_url))
      }
    }

    for (const image of images.value) {
      const mappedId = localToGalleryId.value.get(String(image.id))
      const entry = entryById.get(String(image.id))
        || entryById.get(String(image.galleryId || ''))
        || entryById.get(String(mappedId || ''))
        || entries.find((candidate) =>
          Boolean(candidate.source_id) &&
          candidate.source_id === imageGallerySourceID(image),
        )
        || entries.find((candidate) => sameStoredObject(
          image.src,
          candidate.url,
          window.location.origin,
        ))
        || entries.find((candidate) => sameGalleryDisplayOrder(image, candidate))
      if (!entry) continue
      matchedGalleryIds.add(String(entry.id))
      if (mappedId !== String(entry.id)) {
        localToGalleryId.value.set(String(image.id), String(entry.id))
      }
      image.galleryId = String(entry.id)
      image.gallerySourceId = entry.source_id || image.gallerySourceId
      const storedURL = resolveImageAssetURL(String(entry.url || ''))
      // Object identity stays stable while the signed query string rotates.
      // Always adopt the latest server-issued display URL so expired snapshots
      // do not keep rendering an old signature after gallery refresh.
      if (storedURL && !sameStoredObject(image.src, storedURL, window.location.origin)) {
        image.src = storedURL
        resetImageMediaState(image)
      }
      const storedThumbURL = String(entry.thumb_url || '')
      if (
        storedThumbURL
        && !isInlineImageSource(image.thumbSrc)
        && !sameStoredObject(image.thumbSrc, storedThumbURL, window.location.origin)
      ) {
        image.thumbSrc = storedThumbURL
        image.thumbSrcSet = ''
        resetImageMediaState(image)
      }
      image.prompt = entry.prompt
      image.model = entry.model
      image.size = entry.size
      image.format = entry.format
      image.saved = entry.saved !== false
      image.expiresAt = entry.expires_at || 0
      image.durationMs = Number(entry.duration_ms || 0) || image.durationMs
      image.createdAt = entry.created_at || image.createdAt
      // A task owns its card slot from submission time. Gallery refreshes may
      // update status and storage URLs, but must not reorder a live result.
      image.displayOrder = stableDisplayOrder(image.displayOrder, Number(entry.sort_order || 0))
    }
    const seen = new Set<string>()
    const gallery = entries
      // 本会话刚保存进图库的图片，本地已经有一份可显示的数据副本；
      // 再从图库列表渲染一份就会变成"生成一个却显示两个"。
      .filter((entry) => !locallySavedGalleryIds.has(String(entry.id)))
      .filter((entry) => !matchedGalleryIds.has(String(entry.id)))
      .map((entry, index) => galleryEntryToImage(entry, index))
      .filter((item) => {
        const key = String(item.id || item.src)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    const merged = [...images.value, ...gallery].filter((item, index, all) => {
      const key = String(item.id || item.src)
      return all.findIndex((candidate) => String(candidate.id || candidate.src) === key) === index
    })
    // Every gallery merge has one ordering contract. Keep the immutable
    // generation slot even when save status or the server response changes.
    const ordered = sortStudioItemsByDisplayOrder(merged)
    if (!sameImageIdentityOrder(images.value, ordered)) {
      images.value = ordered
    }
    pruneExpiredImages()
    for (const entry of entries) {
      const localImage = images.value.find((item) => (
        String(item.id) === String(entry.id)
        || localToGalleryId.value.get(String(item.id)) === String(entry.id)
      ))
      if (
        !isInlineImageSource(localImage?.thumbSrc)
        && !(localImage && isImageMediaLoaded(localImage))
      ) {
        void scheduleGalleryThumbnail(entry.id)
      }
    }
  } catch {
    // Gallery storage is optional; generation remains available without it.
  }
}

function sameGalleryDisplayOrder(image: GeneratedImage, entry: ImageStudioGalleryEntry) {
  const imageOrder = Number(image.displayOrder || 0)
  const entryOrder = Number(entry.sort_order || 0)
  if (imageOrder <= 0 || entryOrder <= 0 || imageOrder !== entryOrder) return false
  return String(image.prompt || '') === String(entry.prompt || '')
    && String(image.model || '') === String(entry.model || '')
}

function isInlineImageSource(value: string | undefined) {
  return Boolean(value && (/^data:image\//i.test(value) || /^blob:/i.test(value)))
}

async function loadGalleryThumbnail(id: string, forceServer = false) {
  const image = images.value.find((item) => (
    String(item.id) === id
    || localToGalleryId.value.get(String(item.id)) === id
  ))
  if (!image || isInlineImageSource(image.thumbSrc)) return
  const cached = galleryThumbnailDataUrls.get(id)
  if (cached) {
    image.thumbSrc = cached
    image.thumbSrcSet = ''
    resetImageMediaState(image)
    return
  }
  // The object store already serves a 720px thumbnail. Use it directly instead
  // of asking the backend to download and resize the original image.
  if (!forceServer && /^https?:\/\//i.test(image.thumbSrc || '')) {
    resetImageMediaState(image)
    armImageMediaTimeout(image)
    return
  }
  try {
    const blob = await imageStudioGalleryAPI.thumbnail(id)
    const dataURL = await blobToDataURL(blob)
    galleryThumbnailDataUrls.set(id, dataURL)
    image.thumbSrc = dataURL
    image.thumbSrcSet = ''
    resetImageMediaState(image)
    armImageMediaTimeout(image)
    if (previewImage.value?.id === image.id) void loadPreviewDisplay(image)
  } catch {
    image.thumbSrc = forceServer ? '' : (galleryRemoteThumbUrls.get(id) || '')
    image.thumbSrcSet = ''
    resetImageMediaState(image)
    armImageMediaTimeout(image)
  }
}

function scheduleGalleryThumbnail(id: string, forceServer = false) {
  const key = `${id}:${forceServer ? 'server' : 'direct'}`
  const existing = scheduledGalleryThumbnailLoads.get(key)
  if (existing) return existing
  const epoch = galleryThumbnailEpoch
  const task = withGalleryThumbnailSlot(async () => {
    if (epoch !== galleryThumbnailEpoch) return
    await loadGalleryThumbnail(id, forceServer)
  })
    .finally(() => {
      if (scheduledGalleryThumbnailLoads.get(key) === task) {
        scheduledGalleryThumbnailLoads.delete(key)
      }
    })
  scheduledGalleryThumbnailLoads.set(key, task)
  return task
}

function withGalleryThumbnailSlot(task: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    const run = () => {
      activeGalleryThumbnailLoads += 1
      task()
        .then(resolve, reject)
        .finally(() => {
          activeGalleryThumbnailLoads = Math.max(0, activeGalleryThumbnailLoads - 1)
          queuedGalleryThumbnailLoads.shift()?.()
        })
    }
    if (activeGalleryThumbnailLoads < GALLERY_THUMBNAIL_CONCURRENCY) {
      run()
      return
    }
    queuedGalleryThumbnailLoads.push(run)
  })
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('failed to read thumbnail'))
    reader.readAsDataURL(blob)
  })
}

function galleryEntryToImage(entry: ImageStudioGalleryEntry, index: number): GeneratedImage {
  return {
    id: entry.id,
    galleryId: entry.id,
    gallerySourceId: entry.source_id,
    title: `历史图片 ${index + 1}`,
    src: resolveImageAssetURL(entry.url),
    thumbSrc: entry.thumb_url || '',
    thumbSrcSet: '',
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
    displayOrder: Number(entry.sort_order || 0) || undefined,
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
    const restoredEntries = stored
      .filter((item): item is GeneratedImage => (
        item
        && item.pending
        && Number.isFinite(Number(item.id))
        && typeof item.taskId === 'string'
        && item.taskId.length > 0
      ))
      .map((item) => {
        const startedAt = Number(item.startedAt) > 0 ? Number(item.startedAt) : Date.now()
        const timedOut = Date.now() - startedAt >= IMAGE_GENERATION_TIMEOUT_MS
        return {
          ...item,
          title: timedOut ? '生成失败' : '正在生成',
          src: '',
          pending: !timedOut,
          failed: timedOut,
          error: timedOut ? IMAGE_GENERATION_TIMEOUT_MESSAGE : undefined,
          startedAt,
        }
      })
    const timedOutEntries = restoredEntries.filter((item) => item.failed)
    const restoredAll = restoredEntries.filter((item) => item.pending)
    const restored = restoredAll
    if (!restored.length && !timedOutEntries.length) {
      localStorage.removeItem(pendingImageStorageKey(userId))
      return
    }
    nextImageId = Math.max(nextImageId, ...restoredEntries.map((item) => Number(item.id) + 1))
    imageDisplayOrderCursor = Math.max(
      imageDisplayOrderCursor,
      ...restoredEntries.map((item) => Number(item.displayOrder) || 0),
    )
    images.value = mergeImagesByDisplayOrder(
      images.value,
      [...restored, ...timedOutEntries],
    )
    persistPendingImages()
    const serviceWorkerPending = restored.filter((item) => !item.gatewayPollUrl && !item.gatewaySubmitPending)
    if (serviceWorkerPending.length && 'serviceWorker' in navigator && typeof indexedDB !== 'undefined') {
      appStore.showSuccess(`已恢复 ${restored.length} 个后台生成任务`, 3000)
      void resumePersistentGeneration(serviceWorkerPending)
    }
  } catch {
    // Ignore malformed browser storage and continue with an empty gallery.
  }
}

function restoreFailedImages() {
  try {
    const userId = authStore.user?.id
    if (userId == null) return
    const stored = JSON.parse(localStorage.getItem(failedImageStorageKey(userId)) || '[]')
    if (!Array.isArray(stored)) return
    const restored = stored
      .filter((item): item is GeneratedImage => (
        item
        && item.failed === true
        && typeof item.error === 'string'
        && Number.isFinite(Number(item.id))
      ))
      .map((item) => ({
        ...item,
        id: Number(item.id),
        title: '生成失败',
        src: '',
        pending: false,
        failed: true,
        saved: false,
        expiresAt: 0,
        createdAt: Number(item.createdAt) || Math.floor(Date.now() / 1000),
      }))
    if (!restored.length) return
    nextImageId = Math.max(nextImageId, ...restored.map((item) => Number(item.id) + 1))
    imageDisplayOrderCursor = Math.max(
      imageDisplayOrderCursor,
      ...restored.map((item) => Number(item.displayOrder) || 0),
    )
    images.value = mergeImagesByDisplayOrder(images.value, restored)
  } catch {
    // Ignore malformed browser storage and keep the gallery usable.
  }
}

function applyInspirationFromRoute() {
  try {
    sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY)
    const userId = authStore.user?.id
    if (userId == null) return
    const storageKey = pendingPromptStorageKey(userId)
    const pending = sessionStorage.getItem(storageKey)
    if (pending && pending.trim()) {
      prompt.value = pending.trim()
      appStore.showSuccess('已带入图片灵感提示词，选好模型和尺寸就可以生成。', 3000)
      sessionStorage.removeItem(storageKey)
    }
  } catch {
    // 浏览器存储不可用时按没有待带入提示词处理。
  }
}

function resumeAmbiguousTasksOnOnline() {
  const pending = images.value.filter((item) => (
    item.pending
    && item.gatewaySubmitPending
    && !item.gatewayPollUrl
  ))
  if (pending.length) void resumeAmbiguousGatewaySubmissions(pending)
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

function persistFailedImages() {
  try {
    const userId = authStore.user?.id
    if (userId == null) return
    const failed = images.value
      .filter((item) => item.failed && !item.pending)
      .slice(0, 100)
    if (failed.length) localStorage.setItem(failedImageStorageKey(userId), JSON.stringify(failed))
    else localStorage.removeItem(failedImageStorageKey(userId))
  } catch {
    // Browser storage is optional.
  }
}

async function resumePersistentGeneration(pendingImages: GeneratedImage[]) {
  const owner = captureStudioOwner()
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
    if (!isStudioOwnerCurrent(owner)) return
    resumedGenerationBatches.add(batchId)
    activeGenerations.value += 1
    generating.value = true
    const progress = createGenerationProgress(owner)
    const clearGenerationTimeoutTimer = schedulePendingImagesTimeout(batch, owner)
    try {
      const imagesByTaskId = new Map(
        batch.map((image) => [String(image.taskId), image]),
      )
      const responses = await waitForPersistentImageGeneration(
        batch.map((image) => image.taskId!).filter(Boolean),
        {
          isCancelled: () => componentDisposed || !isStudioOwnerCurrent(owner),
          onResponse: async (id, response) => {
            const image = imagesByTaskId.get(id)
            if (!image) return
            await progress.enqueue(image, workerResponseToSettledResult(response))
          },
        },
      )
      const settledResults = responses.map(workerResponseToSettledResult)
      for (let index = 0; index < settledResults.length; index += 1) {
        const image = batch[index]
        if (!image) continue
        await progress.enqueue(image, settledResults[index])
      }
      if (!isStudioOwnerCurrent(owner)) return
      applyGenerationFailures(batch, settledResults, owner)
      await progress.drain()
      if (progress.stillRunning) {
        markPendingImagesTimedOut(batch, owner)
        errorMessage.value = IMAGE_GENERATION_TIMEOUT_MESSAGE
        continue
      }
      removePendingImages(
        batch.filter((image) => image.pending && !progress.completedIds.has(image.id)),
        owner,
      )
      if (!isStudioOwnerCurrent(owner)) return
      if (progress.generatedCount === 0) {
        errorMessage.value = errorMessageFrom(progress.firstError, '恢复图片生成任务失败')
        continue
      }
      if (progress.firstError) {
        errorMessage.value = errorMessageFrom(progress.firstError, '部分图片生成失败')
      }
    } catch (error) {
      if (error instanceof ImageGenerationWaitCancelled) return
      if (error instanceof ImageGenerationStillRunning) {
        markPendingImagesTimedOut(batch, owner)
        errorMessage.value = error.message
        continue
      }
      markPendingImagesFailed(batch, error, owner)
      if (!isStudioOwnerCurrent(owner)) return
      errorMessage.value = errorMessageFrom(error, '恢复图片生成任务失败')
    } finally {
      clearGenerationTimeoutTimer()
      if (isStudioOwnerCurrent(owner)) {
        resumedGenerationBatches.delete(batchId)
        activeGenerations.value = Math.max(0, activeGenerations.value - 1)
        generating.value = activeGenerations.value > 0
      }
    }
  }
}

async function persistGeneratedImages(
  items: GeneratedImage[],
  prompt: string,
  model: string,
  options: { refresh?: boolean; owner?: StudioOwnerSnapshot } = {},
) {
  await Promise.all(items.map((item) => imageProcessingTasks.get(String(item.id))))
  if (options.owner && !isStudioOwnerCurrent(options.owner)) return false
  const persistenceTasks = items.map(async (item) => {
    if (options.owner && !isStudioOwnerCurrent(options.owner)) {
      throw new ImageGenerationWaitCancelled()
    }
    // data: 前缀直接上传；http(s) 交给服务端下载转存，
    // 避免浏览器抓上游图片时被 CORS 拦掉导致保存失败。
    const entry = await saveImageToGallery(item, prompt, model, false)
    return { item, entry }
  })
  persistenceTasks.forEach((task, index) => {
    const localId = String(items[index].id)
    const pendingId = task.then(({ entry }) => String(entry.id || ''))
    pendingGalleryImageIds.set(localId, pendingId)
    const clearPendingId = () => {
      if (pendingGalleryImageIds.get(localId) === pendingId) {
        pendingGalleryImageIds.delete(localId)
      }
    }
    void pendingId.then(clearPendingId, clearPendingId)
  })
  const results = await Promise.allSettled(persistenceTasks)
  if (options.owner && !isStudioOwnerCurrent(options.owner)) return false
  const succeeded = results.filter((result) => result.status === 'fulfilled').length
  const failed = results.length - succeeded
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value?.entry?.id) {
      locallySavedGalleryIds.add(String(result.value.entry.id))
      galleryBackedIds.value.add(String(result.value.entry.id))
      localToGalleryId.value.set(String(result.value.item.id), String(result.value.entry.id))
      result.value.item.galleryId = String(result.value.entry.id)
      result.value.item.gallerySourceId = result.value.entry.source_id || imageGallerySourceID(result.value.item)
      // 记住服务端状态，卡片上才能显示"还剩 N 天 / 已保存"。
      result.value.item.saved = result.value.entry.saved !== false
      result.value.item.expiresAt = result.value.entry.expires_at || 0
      result.value.item.displayOrder = stableDisplayOrder(
        result.value.item.displayOrder,
        Number(result.value.entry.sort_order || 0),
      )
      const storedURL = resolveImageAssetURL(String(result.value.entry.url || ''))
      if (storedURL && !sameStoredObject(
        result.value.item.src,
        storedURL,
        window.location.origin,
      )) {
        result.value.item.src = storedURL
        result.value.item.originalSrc = storedURL
        resetImageMediaState(result.value.item)
      }
      const storedThumbURL = String(result.value.entry.thumb_url || '')
      if (
        storedThumbURL
        && !isInlineImageSource(result.value.item.thumbSrc)
        && !sameStoredObject(
          result.value.item.thumbSrc,
          storedThumbURL,
          window.location.origin,
        )
      ) {
        result.value.item.thumbSrc = storedThumbURL
        result.value.item.thumbSrcSet = ''
        resetImageMediaState(result.value.item)
      }
    }
  }
  images.value = sortStudioItemsByDisplayOrder(images.value)
  if (succeeded > 0 && options.refresh !== false) {
    await loadGallery(options.owner?.epoch, options.owner?.userId)
    await loadStudioQuota(options.owner?.epoch, options.owner?.userId)
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

async function saveImageToGallery(
  image: GeneratedImage,
  prompt: string,
  model: string,
  saved: boolean,
) {
  const serverTaskID = String(image.gatewayTaskId || '').trim()
  if (serverTaskID) {
    return imageStudioGalleryAPI.saveFromTask({
      task_id: serverTaskID,
      image_index: 0,
      prompt,
      model,
      size: image.size || size.value,
      format: image.format || format.value,
      duration_ms: image.durationMs || undefined,
      created_at: image.createdAt || undefined,
      sort_order: image.displayOrder,
      saved,
    })
  }
  const source = image.src.startsWith('data:')
    ? { image_data_url: image.src }
    : { image_url: image.src }
  return imageStudioGalleryAPI.save({
    ...source,
    source_id: imageGallerySourceID(image),
    prompt,
    model,
    size: image.size || size.value,
    format: image.format || format.value,
    duration_ms: image.durationMs || undefined,
    created_at: image.createdAt || undefined,
    sort_order: image.displayOrder,
    saved,
  })
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

// 临时内容的剩余天数：向上取整，过期后显示 0。
function remainingDays(image: GeneratedImage): number {
  const expiresAt = Number(image.expiresAt || 0)
  if (!expiresAt) return 0
  return Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000))
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

function isAnimatedImage(image: GeneratedImage) {
  return isAnimatedImageSource(image, gifFormatOption.value)
}

function imageMediaDisplaySrc(image: GeneratedImage, preferred?: string) {
  const nonce = imageMediaRetryNonce.value.get(imageMediaId(image)) || 0
  return preferred
    ? resolveExplicitImageMediaSource(preferred, nonce)
    : resolveImageMediaSource(image, nonce, gifFormatOption.value)
}

function isShowingThumbnail(image: GeneratedImage) {
  return !isAnimatedImage(image) && Boolean(image.thumbSrc && image.src && image.thumbSrc !== image.src)
}

function isPreviewShowingThumbnail(image: GeneratedImage) {
  return Boolean(
    previewDisplaySrc.value
    && (image.src || image.previewSrc)
    && previewDisplaySrc.value !== image.src,
  )
}

function canOpenImagePreview(image: GeneratedImage) {
  return isImageTaskDisplayReady(image)
}

function isImageMediaLoaded(image: GeneratedImage) {
  return loadedImageMediaIds.value.has(imageMediaId(image))
}

function isImageMediaFailed(image: GeneratedImage) {
  return failedImageMediaIds.value.has(imageMediaId(image))
}

function markImageMediaLoaded(image: GeneratedImage) {
  const id = imageMediaId(image)
  clearImageMediaTimeout(image)
  failedImageMediaIds.value.delete(id)
  loadedImageMediaIds.value.add(id)
  reportImageDisplay(image)
  startImageDisplayProcessing(image)
}

const reportedImageDisplayTaskIds = new Set<string>()

function reportImageDisplay(image: GeneratedImage) {
  const taskId = String(image.gatewayTaskId || '').trim()
  if (!taskId || reportedImageDisplayTaskIds.has(taskId)) return
  reportedImageDisplayTaskIds.add(taskId)
  const startedAt = Number(image.startedAt || 0)
  const displayDurationMs = startedAt > 0
    ? Math.max(1, Date.now() - startedAt)
    : image.durationMs
  void imageStudioGalleryAPI.reportDisplay(taskId, displayDurationMs).catch(() => {
    reportedImageDisplayTaskIds.delete(taskId)
  })
}

function markImageMediaFailed(image: GeneratedImage) {
  const id = imageMediaId(image)
  clearImageMediaTimeout(image)
  loadedImageMediaIds.value.delete(id)
  failedImageMediaIds.value.add(id)
  startImageDisplayProcessing(image)
}

function queueImageDisplayProcessing(
  image: GeneratedImage,
  source: string,
  targetSize: string,
  targetFormat: string,
  owner: StudioOwnerSnapshot | undefined,
  onError: (error: string) => void,
) {
  // Canvas resizing blocks the main thread; start it only after the first image
  // load so preview visibility is not delayed by multi-megapixel encoding.
  const key = String(image.id)
  const existing = imageProcessingTasks.get(key)
  if (existing) return existing

  let resolveTask!: () => void
  const task = new Promise<void>((resolve) => {
    resolveTask = resolve
  })
  pendingImageDisplayProcessing.set(key, {
    image,
    source,
    targetSize,
    targetFormat,
    owner,
    resolve: resolveTask,
    onError,
  })
  imageProcessingTasks.set(key, task)
  const fallbackTimer = window.setTimeout(() => {
    startImageDisplayProcessing(image)
  }, IMAGE_DISPLAY_PROCESSING_FALLBACK_MS)
  imageDisplayProcessingFallbackTimers.set(key, fallbackTimer)
  return task
}

function startImageDisplayProcessing(image: GeneratedImage) {
  const key = String(image.id)
  const pending = pendingImageDisplayProcessing.get(key)
  if (!pending) return
  pendingImageDisplayProcessing.delete(key)
  const fallbackTimer = imageDisplayProcessingFallbackTimers.get(key)
  if (fallbackTimer) window.clearTimeout(fallbackTimer)
  imageDisplayProcessingFallbackTimers.delete(key)

  void processImageForDisplay(
    pending.source,
    pending.targetSize,
    pending.targetFormat,
  ).then((processed) => {
    if (pending.owner && !isStudioOwnerCurrent(pending.owner)) return
    pending.image.src = processed.src
    pending.image.originalSrc = pending.source
    pending.image.format = processed.format
    pending.image.meta = `${processed.format.toUpperCase()} · ${pending.targetSize} · ${pending.image.model || imageModel.value}`
    images.value = [...images.value]
    if (processed.error) pending.onError(processed.error)
  }).catch((error) => {
    if (pending.owner && !isStudioOwnerCurrent(pending.owner)) return
    pending.onError(error instanceof Error ? error.message : 'image processing failed')
  }).finally(() => {
    imageProcessingTasks.delete(key)
    pending.resolve()
  })
}

function cancelPendingImageDisplayProcessing() {
  for (const timer of imageDisplayProcessingFallbackTimers.values()) window.clearTimeout(timer)
  imageDisplayProcessingFallbackTimers.clear()
  for (const pending of pendingImageDisplayProcessing.values()) pending.resolve()
  pendingImageDisplayProcessing.clear()
  imageProcessingTasks.clear()
}

function bindImageMediaElement(image: GeneratedImage, element: unknown) {
  if (!(element instanceof HTMLImageElement) || !element.complete) return
  if (element.naturalWidth > 0) {
    markImageMediaLoaded(image)
  } else {
    handleImageMediaError(image)
  }
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
    const galleryID = galleryIdFor(image)
    const mediaID = imageMediaId(image)
    if (
      /^https?:\/\//i.test(image.thumbSrc)
      && galleryID
      && galleryBackedIds.value.has(galleryID)
      && !galleryThumbnailRecoveryIds.has(mediaID)
    ) {
      galleryThumbnailRecoveryIds.add(mediaID)
      resetImageMediaState(image)
      void scheduleGalleryThumbnail(galleryID, true).finally(() => {
        galleryThumbnailRecoveryIds.delete(mediaID)
      })
      return
    }
    image.thumbSrc = ''
    resetImageMediaState(image)
    return
  }
  markImageMediaFailed(image)
}

function resetImageMediaState(image: GeneratedImage, bumpRetry = false) {
  const id = imageMediaId(image)
  clearImageMediaTimeout(image)
  loadedImageMediaIds.value.delete(id)
  failedImageMediaIds.value.delete(id)
  if (bumpRetry) {
    imageMediaRetryNonce.value.set(id, (imageMediaRetryNonce.value.get(id) || 0) + 1)
  }
}

function clearImageMediaTimeout(image: GeneratedImage) {
  const id = imageMediaId(image)
  const timer = imageMediaTimeoutIds.get(id)
  if (!timer) return
  clearTimeout(timer)
  imageMediaTimeoutIds.delete(id)
}

function armImageMediaTimeout(image: GeneratedImage) {
  clearImageMediaTimeout(image)
  if (image.pending || isImageMediaLoaded(image) || isImageMediaFailed(image)) return
  const id = imageMediaId(image)
  const timer = setTimeout(() => {
    imageMediaTimeoutIds.delete(id)
    if (image.pending || isImageMediaLoaded(image) || isImageMediaFailed(image)) return
    // Drop the slow thumbnail/source once, which triggers the server-side
    // thumbnail recovery chain before falling back to the original.
    handleImageMediaError(image)
  }, IMAGE_MEDIA_LOAD_TIMEOUT_MS)
  imageMediaTimeoutIds.set(id, timer)
}

function retryImageMedia(image: GeneratedImage) {
  resetImageMediaState(image, true)
  if (previewImage.value?.id === image.id) {
    void loadPreviewDisplay(image)
  }
}

let previewLoadToken = 0
let galleryURLRefreshTimer: ReturnType<typeof setInterval> | null = null
let galleryRefreshDeferred = false

async function loadPreviewDisplay(image: GeneratedImage) {
  const token = ++previewLoadToken
  const thumbnail = image.previewSrc || image.thumbSrc || image.thumbSrcSet || image.src
  previewDisplaySrc.value = thumbnail
  if (!thumbnail || thumbnail === image.src || typeof Image === 'undefined') return
  // Let the dialog paint the existing thumbnail before competing for network
  // and decode work with the full-resolution original.
  await nextTick()
  if (token !== previewLoadToken || previewImage.value?.id !== image.id) return

  const loader = new Image()
  loader.decoding = 'async'
  loader.fetchPriority = 'low'
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
let expiryPruneTimer: ReturnType<typeof setInterval> | null = null

function refreshGalleryURLsIfVisible() {
  if (componentDisposed) return
  if (!studioStateOwnerId.value) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  refreshGalleryAfterExternalChange()
}

function handleGalleryVisibilityChange() {
  if (document.visibilityState === 'visible') refreshGalleryURLsIfVisible()
}

function startGalleryURLRefreshTimer() {
  if (galleryURLRefreshTimer) return
  galleryURLRefreshTimer = setInterval(
    refreshGalleryURLsIfVisible,
    GALLERY_URL_REFRESH_INTERVAL_MS,
  )
}

function stopGalleryURLRefreshTimer() {
  if (!galleryURLRefreshTimer) return
  clearInterval(galleryURLRefreshTimer)
  galleryURLRefreshTimer = null
}

function pruneExpiredImages() {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expired = images.value.filter((image) => (
    !image.pending
    && !image.saved
    && Number(image.expiresAt || 0) > 0
    && Number(image.expiresAt) <= nowSeconds
  ))
  if (!expired.length) return
  const expiredIds = new Set(expired.map((image) => imageMediaId(image)))
  images.value = images.value.filter((image) => !expiredIds.has(imageMediaId(image)))
  if (previewImage.value && expiredIds.has(imageMediaId(previewImage.value))) {
    previewImage.value = null
    previewDisplaySrc.value = ''
  }
  if (studioStateOwnerId.value) writeStudioSnapshot(studioStateOwnerId.value)
}

function startExpiryPruneTimer() {
  pruneExpiredImages()
  if (expiryPruneTimer) return
  expiryPruneTimer = setInterval(pruneExpiredImages, 60_000)
}

function stopExpiryPruneTimer() {
  if (!expiryPruneTimer) return
  clearInterval(expiryPruneTimer)
  expiryPruneTimer = null
}

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
    const entry = await saveImageToGallery(
      image,
      promptText,
      image.model || imageModel.value,
      true,
    )
    locallySavedGalleryIds.add(String(entry.id))
    galleryBackedIds.value.add(String(entry.id))
    localToGalleryId.value.set(String(image.id), String(entry.id))
    image.galleryId = String(entry.id)
    image.gallerySourceId = entry.source_id || imageGallerySourceID(image)
    image.saved = entry.saved !== false
    image.expiresAt = entry.expires_at || 0
    image.prompt = promptText
    if (entry.url) image.src = resolveImageAssetURL(entry.url)
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

async function loadStudioQuota(epoch = studioUserEpoch, ownerId = studioStateOwnerId.value) {
  try {
    const quota = await imageStudioGalleryAPI.quota()
    if (epoch !== studioUserEpoch || ownerId !== studioStateOwnerId.value) return
    studioQuota.value = quota
  } catch {
    // 配额展示是锦上添花，读不到就不显示。
  }
}

// 删除作品：后端先删对象存储里的文件、再删记录，成功后本地也把它移掉。
// 刚保存进图库的图片卡片上还是本地 id，所以要先用映射换成服务端的作品 id。
function galleryIdFor(image: GeneratedImage): string {
  const local = String(image.id)
  return String(image.galleryId || '') || localToGalleryId.value.get(local) || local
}

function imageGallerySourceID(image: GeneratedImage): string {
  const taskId = String(image.gatewayTaskId || image.taskId || '').trim()
  return taskId
    ? `image-task:${taskId}:0`
    : String(image.gallerySourceId || '')
}

async function galleryIdForDownload(image: GeneratedImage): Promise<string> {
  const id = galleryIdFor(image)
  if (id && galleryBackedIds.value.has(id)) return id
  const pendingId = pendingGalleryImageIds.get(String(image.id))
  if (!pendingId) return id
  try {
    return await pendingId
  } catch {
    return id
  }
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
  return mime && imageFormatValues.has(mime) ? mime : fallback
}

function imageFormatFromResult(item: any, src: string, fallback: string): string {
  const outputFormat = normalizeImageFormat(item?.output_format)
  if (outputFormat) return outputFormat
  const mime = String(item?.mimeType || item?.mime_type || '')
    .trim()
    .toLowerCase()
    .replace('image/jpg', 'image/jpeg')
  const format = mime.startsWith('image/') ? mime.slice('image/'.length) : ''
  return format && imageFormatValues.has(format)
    ? format
    : imageFormatFromSource(src, fallback)
}

function normalizeImageFormat(value: unknown): string {
  const format = String(value || '').trim().toLowerCase().replace('jpg', 'jpeg')
  return imageFormatValues.has(format) ? format : ''
}

function imageMIMETypeForFormat(value: unknown): string {
  switch (normalizeImageFormat(value)) {
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

async function loadModels() {
  const requestId = ++modelRequestId
  const preferredModel = readStoredStudioPreferences(localStorage, authStore.user?.id).model
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
  return formatImageStudioErrorMessage(error, {
    fallback,
    isAdmin: authStore.isAdmin,
  })
}

async function generate() {
  if (!canGenerate.value || !selectedKey.value) return
  const owner = captureStudioOwner()
  generating.value = true
  activeGenerations.value += 1
  const currentPrompt = generationPrompt.value
  lastSubmittedPrompt.value = currentPrompt
  const currentKey = selectedKey.value
  const currentModel = imageModel.value.trim()
  const currentQuality = quality.value
  const currentFormat = format.value
  const currentBackground = background.value
  const currentAppliedSize = { ...appliedSize }
  const currentSize = formatSize(currentAppliedSize)
  const requestCount = normalizeImageRequestCount(count.value)
  const batchId = createImageGenerationTaskId()
  const startedAt = Date.now()
  const displayOrder = allocateImageQueueDisplayOrder(
    imageDisplayOrderCursor,
    startedAt,
    requestCount,
  )
  imageDisplayOrderCursor = displayOrder.nextCursor
  const requestReferences = references.value.map((item) => ({ ...item }))
  generationRequestSnapshots.set(batchId, {
    prompt: currentPrompt,
    model: currentModel,
    size: currentSize,
    quality: currentQuality,
    format: currentFormat,
    background: currentBackground,
    apiKeyId: currentKey.id,
    appliedSize: currentAppliedSize,
    references: requestReferences,
  })
  const pendingBatch = createPendingImageBatch({
    count: requestCount,
    nextImageId,
    createTaskId: createImageGenerationTaskId,
    batchId,
    apiKeyId: currentKey.id,
    startedAt,
    displayOrderBase: displayOrder.order,
    prompt: currentPrompt,
    model: currentModel,
    size: currentSize,
    format: currentFormat,
    quality: currentQuality,
    background: currentBackground,
    customSizeRequested: currentAppliedSize.mode === 'custom',
    hadReferences: requestReferences.length > 0,
  })
  const pendingImages = pendingBatch.images
  nextImageId = pendingBatch.nextImageId
  images.value.unshift(...pendingImages)
  persistPendingImages()
  errorMessage.value = ''
  const geminiModel = isGeminiModel(currentModel)
  const grokModel = isGrokImageModelName(currentModel)
  const progress = createGenerationProgress(owner)
  let clearGenerationTimeoutTimer: (() => void) | undefined
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${currentKey.key}` }
    let url = `${apiBaseUrl.value}${requestReferences.length ? '/images/edits' : '/images/generations'}`
    let body: string | FormData
    let preparedReferences: PreparedImageReference[] = []
    let remoteReferenceURLs: string[] = []
    if (requestReferences.length) {
      preparedReferences = await prepareImageReferenceImages(
        requestReferences.map((item) => ({ name: item.name, blob: item.file })),
      )
      remoteReferenceURLs = await uploadPreparedImageReferences(preparedReferences)
      if (!isStudioOwnerCurrent(owner)) return
    }
    if (geminiModel) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(buildGeminiPayload(currentPrompt, preparedReferences, {
        size: currentSize,
        quality: currentQuality,
        appliedSize: currentAppliedSize,
      }))
      url = buildGeminiURL(apiBaseUrl.value, currentModel, currentKey.group?.platform)
    } else if (requestReferences.length) {
      if (remoteReferenceURLs.length === preparedReferences.length) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(buildEditURLPayload(currentPrompt, remoteReferenceURLs, {
          model: currentModel,
          size: currentSize,
          quality: currentQuality,
          format: currentFormat,
          background: currentBackground,
        }))
      } else {
        body = buildEditForm(
          currentPrompt,
          preparedReferences,
          {
            model: currentModel,
            size: currentSize,
            quality: currentQuality,
            format: currentFormat,
            background: currentBackground,
          },
          references.value,
        )
      }
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({
        model: currentModel,
        prompt: currentPrompt,
        size: currentSize,
        quality: currentQuality,
        output_format: currentFormat,
        background: currentBackground,
        n: 1,
        response_format: 'b64_json',
        ...(grokModel && currentAppliedSize.mode === 'ratio'
          ? {
              resolution: grokResolutionForBase(currentAppliedSize.aspectBase).toLowerCase(),
              aspect_ratio: currentAppliedSize.aspectRatio,
            }
          : {}),
      })
    }
    const requestStartedAt = Date.now()
    pendingImages.forEach((image) => {
      image.startedAt = requestStartedAt
    })
    clearGenerationTimeoutTimer = schedulePendingImagesTimeout(pendingImages, owner)
    persistPendingImages()
    const results = await executeGenerationRequests(
      pendingImages,
      url,
      headers,
      body,
      geminiModel,
      progress.enqueue,
    )
    const unconfirmedImages = pendingImages.filter((_, index) => (
      results[index]?.status === 'rejected'
      && results[index].reason instanceof ImageSubmissionUnconfirmed
    ))
    for (const result of results) {
      if (result.status === 'rejected') progress.recordError(result.reason)
    }
    applyGenerationFailures(pendingImages, results, owner)
    await progress.drain()
    if (progress.stillRunning) {
      markPendingImagesTimedOut(pendingImages, owner)
      errorMessage.value = IMAGE_GENERATION_TIMEOUT_MESSAGE
      return
    }
    removePendingImages(
      pendingImages.filter((image) => (
        image.pending
        && !progress.completedIds.has(image.id)
        && !unconfirmedImages.includes(image)
      )),
      owner,
    )
    if (!isStudioOwnerCurrent(owner)) return
    if (unconfirmedImages.length) {
      appStore.showInfo('网络连接异常，图片任务仍在后台确认中', 5000)
      void resumeAmbiguousGatewaySubmissions(unconfirmedImages)
    }
    if (progress.generatedCount === 0) {
      if (unconfirmedImages.length) return
      errorMessage.value = errorMessageFrom(progress.firstError, '生成失败')
      return
    }
    if (progress.firstError) {
      errorMessage.value = errorMessageFrom(progress.firstError, '部分图片生成失败')
    }
    if (!pendingImages.some((image) => image.failed)) {
      generationRequestSnapshots.delete(batchId)
    }
  } catch (error) {
    if (error instanceof ImageGenerationWaitCancelled) return
    if (error instanceof ImageGenerationStillRunning) {
      markPendingImagesTimedOut(pendingImages, owner)
      errorMessage.value = error.message
      return
    }
    markPendingImagesFailed(pendingImages, error, owner)
    if (!isStudioOwnerCurrent(owner)) return
    errorMessage.value = errorMessageFrom(error, '生成失败')
  } finally {
    clearGenerationTimeoutTimer?.()
    if (isStudioOwnerCurrent(owner)) {
      activeGenerations.value = Math.max(0, activeGenerations.value - 1)
      generating.value = activeGenerations.value > 0
    }
  }
}

function isFailedImageRetrying(image: GeneratedImage) {
  return retryingFailureIds.value.has(String(image.id))
}

function setFailedImageRetrying(image: GeneratedImage, retrying: boolean) {
  const next = new Set(retryingFailureIds.value)
  if (retrying) next.add(String(image.id))
  else next.delete(String(image.id))
  retryingFailureIds.value = next
}

function restoreComposerForManualRetry(image: GeneratedImage) {
  prompt.value = image.prompt || prompt.value
  if (image.model) imageModel.value = image.model
  const dimensions = image.size ? parseImageSizeValue(image.size) : null
  if (dimensions) {
    appliedSize.mode = 'custom'
    appliedSize.width = dimensions.width
    appliedSize.height = dimensions.height
  }
  if (image.format) format.value = image.format
  if (image.quality) quality.value = image.quality
  if (image.background) background.value = image.background
}

async function retryFailedImage(image: GeneratedImage) {
  if (isFailedImageRetrying(image)) return
  const snapshot = generationRequestSnapshots.get(String(image.batchId || ''))
  if (image.hadReferences && !snapshot?.references.length) {
    restoreComposerForManualRetry(image)
    appStore.showWarning('原任务使用了参考图，请重新选择参考图后再生成。', 5000)
    return
  }

  const retrySnapshot = snapshot || {
    prompt: image.prompt || '',
    model: image.model || imageModel.value,
    size: image.size || size.value,
    quality: image.quality || quality.value,
    format: image.format || format.value,
    background: image.background || background.value,
    apiKeyId: image.apiKeyId,
    appliedSize: { ...appliedSize },
    references: [],
  }
  const retryKeyId = retrySnapshot.apiKeyId == null ? '' : String(retrySnapshot.apiKeyId)
  if (retryKeyId && !imageCapableKeys.value.some((key) => String(key.id) === retryKeyId)) {
    restoreComposerForManualRetry(image)
    errorMessage.value = '原任务使用的 API Key 已不可用，请选择其他密钥后重试。'
    return
  }

  const previousComposer = {
    prompt: prompt.value,
    model: imageModel.value,
    quality: quality.value,
    format: format.value,
    background: background.value,
    count: count.value,
    selectedKeyId: selectedKeyId.value,
    references: references.value.map((item) => ({ ...item })),
    appliedSize: { ...appliedSize },
  }
  const restoreComposer = () => {
    prompt.value = previousComposer.prompt
    imageModel.value = previousComposer.model
    quality.value = previousComposer.quality
    format.value = previousComposer.format
    background.value = previousComposer.background
    count.value = previousComposer.count
    selectedKeyId.value = previousComposer.selectedKeyId
    references.value = previousComposer.references
    Object.assign(appliedSize, previousComposer.appliedSize)
  }

  setFailedImageRetrying(image, true)
  prompt.value = retrySnapshot.prompt
  imageModel.value = retrySnapshot.model
  quality.value = retrySnapshot.quality
  format.value = retrySnapshot.format
  background.value = retrySnapshot.background
  count.value = 1
  if (retryKeyId) selectedKeyId.value = retryKeyId
  references.value = retrySnapshot.references.map((item) => ({ ...item }))
  Object.assign(appliedSize, retrySnapshot.appliedSize)

  try {
    await nextTick()
    const generation = generate()
    restoreComposer()
    await generation
  } finally {
    setFailedImageRetrying(image, false)
  }
}

function createGenerationProgress(owner: StudioOwnerSnapshot) {
  const completedIds = new Set<GeneratedImage['id']>()
  const inFlightIds = new Set<GeneratedImage['id']>()
  let generatedCount = 0
  let firstError: unknown = null
  let stillRunning = false
  let queue = Promise.resolve()
  let persistenceQueue = Promise.resolve()
  let persistenceNeedsRefresh = false

  const recordError = (error: unknown) => {
    if (error instanceof ImageSubmissionUnconfirmed) return
    if (error instanceof ImageGenerationStillRunning) {
      stillRunning = true
      return
    }
    if (!firstError) firstError = error
  }

  const enqueue: GenerationResultHandler = (image, result) => {
    if (!isStudioOwnerCurrent(owner)) return queue
    if (completedIds.has(image.id) || inFlightIds.has(image.id)) return queue
    inFlightIds.add(image.id)
    queue = queue.then(async () => {
      if (result.status === 'rejected') {
        if (result.reason instanceof ImageGenerationStillRunning) {
          stillRunning = true
          return
        }
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
        owner,
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
            { refresh: false, owner },
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
    get stillRunning() {
      return stillRunning
    },
  }
}

function removePendingImages(
  pendingImages: GeneratedImage[],
  owner?: StudioOwnerSnapshot,
) {
  if (owner && !isStudioOwnerCurrent(owner)) return
  images.value = removePendingTaskImages(images.value, pendingImages, new Set())
  persistPendingImages()
}

function applyGenerationFailures(
  pendingImages: GeneratedImage[],
  results: PromiseSettledResult<any[]>[],
  owner?: StudioOwnerSnapshot,
) {
  if (owner && !isStudioOwnerCurrent(owner)) return
  let changed = false
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return
    if (result.reason instanceof ImageGenerationStillRunning) return
    if (result.reason instanceof ImageSubmissionUnconfirmed) return
    const image = pendingImages[index]
    if (!image) return
    markImageFailed(image, result.reason)
    changed = true
  })
  if (changed) {
    images.value = [...images.value]
    persistPendingImages()
    persistFailedImages()
  }
}

function markPendingImagesTimedOut(
  pendingImages: GeneratedImage[],
  owner?: StudioOwnerSnapshot,
) {
  markPendingImagesFailed(
    pendingImages,
    new Error(IMAGE_GENERATION_TIMEOUT_MESSAGE),
    owner,
  )
}

function schedulePendingImagesTimeout(
  pendingImages: GeneratedImage[],
  owner?: StudioOwnerSnapshot,
) {
  const timer = window.setTimeout(() => {
    if (componentDisposed) return
    markPendingImagesTimedOut(pendingImages, owner)
  }, IMAGE_GENERATION_TIMEOUT_MS)
  return () => window.clearTimeout(timer)
}

function markPendingImagesFailed(
  pendingImages: GeneratedImage[],
  error: unknown,
  owner?: StudioOwnerSnapshot,
) {
  if (owner && !isStudioOwnerCurrent(owner)) return
  if (!pendingImages.length) return
  for (const image of pendingImages) markImageFailed(image, error)
  images.value = [...images.value]
  persistPendingImages()
  persistFailedImages()
}

function markImageFailed(image: GeneratedImage, error: unknown) {
  const message = errorMessageFrom(error, '生成失败')
  failImageTask(image, message)
  reportImageGenerationFailure(image, error, message)
}

function reportImageGenerationFailure(image: GeneratedImage, error: unknown, message: string) {
  // Durable image tasks already record gateway/provider failures. Reporting the
  // same task from the browser duplicates the ops entry and loses its status.
  if (error instanceof ImageGatewayTaskError) return
  const key = `${image.batchId || image.id}:${message}`
  if (reportedGenerationFailures.has(key)) return
  reportedGenerationFailures.add(key)
  const normalized = message.toLowerCase()
  const errorType = normalized.includes('超时')
    || normalized.includes('timeout')
    || normalized.includes('超过 10 分钟')
    || normalized.includes('停止等待')
    ? 'client_timeout'
    : normalized.includes('无法连接') || normalized.includes('network')
      ? 'client_network_error'
      : 'client_generation_error'
  void imageStudioGalleryAPI.reportClientError({
    task_id: String(image.gatewayTaskId || image.taskId || ''),
    batch_id: String(image.batchId || ''),
    model: String(image.model || imageModel.value || ''),
    stage: 'image_generation_failure',
    error_type: errorType,
    message,
    status_code: nestedErrorStatus(error)
      || (errorType === 'client_timeout' ? 504 : errorType === 'client_network_error' ? 499 : 400),
    elapsed_ms: image.startedAt ? Math.max(1, Date.now() - Number(image.startedAt)) : undefined,
    request_id: String(image.gatewayTaskId || image.taskId || ''),
    request_path: image.gatewayPollUrl || '/v1/images/generations',
  }).catch(() => {
    // Reporting must never change the user-visible generation result.
  })
}

function reportVisibleImageStudioError(message: string) {
  const key = message.toLowerCase()
  if (reportedVisibleErrors.has(key)) return
  reportedVisibleErrors.add(key)
  const normalized = message.toLowerCase()
  const errorType = normalized.includes('超时') || normalized.includes('timeout')
    ? 'client_timeout'
    : normalized.includes('无法连接') || normalized.includes('network')
      ? 'client_network_error'
      : 'client_visible_error'
  void imageStudioGalleryAPI.reportClientError({
    model: String(imageModel.value || ''),
    stage: 'image_studio_visible_error',
    error_type: errorType,
    message,
    status_code: errorType === 'client_timeout' ? 504 : errorType === 'client_network_error' ? 499 : 400,
    request_path: '/image-studio',
  }).catch(() => {
    // Reporting must never change the user-visible error.
  })
}

function removeFailedImage(image: GeneratedImage) {
  images.value = images.value.filter((item) => String(item.id) !== String(image.id))
  if (previewImage.value && String(previewImage.value.id) === String(image.id)) {
    previewImage.value = null
  }
  const batchId = String(image.batchId || '')
  if (!images.value.some((item) => item.failed && String(item.batchId || '') === batchId)) {
    generationRequestSnapshots.delete(batchId)
  }
  persistFailedImages()
}

async function waitForGatewayPollRetry(delay: number) {
  if (componentDisposed) throw new ImageGenerationWaitCancelled()
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  if (componentDisposed) throw new ImageGenerationWaitCancelled()
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

function applyGatewayPreview(image: GeneratedImage, items: any[]) {
  const preview = items[0]
  if (!preview) return
  const mime = String(preview.mimeType || preview.mime_type || 'image/png')
  const b64 = String(preview.b64_json || preview.data || '')
  const src = String(
    preview.preview_data_url
    || preview.preview_url
    || (b64 ? `data:${mime};base64,${b64}` : '')
    || preview.display_url
    || preview.url
    || '',
  )
  if (!src) return
  image.previewSrc = src
  images.value = [...images.value]
  persistPendingImages()
}

async function pollGatewayImageTask(
  pollUrl: string,
  headers: Record<string, string>,
  options: {
    isCancelled?: () => boolean
    onPreview?: (items: any[]) => void
    deadline?: number
  } = {},
): Promise<any[]> {
  return pollGatewayImageTaskFromClient(pollUrl, headers, {
    ...options,
    apiBaseUrl: apiBaseUrl.value,
    extractImages,
    timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    timeoutMessage: IMAGE_GENERATION_TIMEOUT_MESSAGE,
    wait: async (delay) => {
      if (componentDisposed) throw new ImageGenerationWaitCancelled()
      await new Promise((resolve) => window.setTimeout(resolve, delay))
      if (componentDisposed) throw new ImageGenerationWaitCancelled()
    },
  })
}

async function fetchGatewayTaskOriginalBlob(
  image: GeneratedImage,
  imageIndex: number,
): Promise<Blob> {
  const taskID = String(image.gatewayTaskId || '').trim()
  if (!taskID) throw new Error('图片任务不存在')
  const apiKey = image.apiKeyId
    ? imageCapableKeys.value.find((key) => Number(key.id) === Number(image.apiKeyId))
    : selectedKey.value
  if (!apiKey?.key) throw new Error('API Key 已不可用，无法读取本地原图')
  const url = `${apiBaseUrl.value.replace(/\/+$/, '')}/images/tasks/${encodeURIComponent(taskID)}/content?index=${imageIndex}`
  const response = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${apiKey.key}` } },
    2 * 60 * 1000,
  )
  if (!response.ok) {
    throw new Error(`读取原图失败（${response.status}）`)
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('本地原图为空')
  return blob
}

async function tryExecuteGatewayAsyncRequests(
  pendingImages: GeneratedImage[],
  syncUrl: string,
  headers: Record<string, string>,
  body: string | FormData,
  geminiModel: boolean,
  onResult?: GenerationResultHandler,
): Promise<PromiseSettledResult<any[]>[] | null> {
  const submitUrl = gatewayAsyncSubmitUrl(apiBaseUrl.value, syncUrl, geminiModel)
  const submitted: Array<{ image: GeneratedImage; pollUrl: string }> = []
  const results: Array<PromiseSettledResult<any[]> | null> = new Array(pendingImages.length).fill(null)
  let ambiguousSubmission = false

  for (const [imageIndex, image] of pendingImages.entries()) {
    let requestBody: string | FormData = body
    if (geminiModel) {
      if (typeof body !== 'string') throw new Error('Gemini 图片请求格式无效')
      requestBody = JSON.stringify({
        model: image.model || imageModel.value,
        request: JSON.parse(body),
      })
    }
    const idempotencyKey = image.taskId || createImageGenerationTaskId()
    image.taskId = idempotencyKey
    const requestHeaders = {
      ...headers,
      'Idempotency-Key': idempotencyKey,
    }
    const generationDeadline = Number(image.startedAt || 0) > 0
      ? Number(image.startedAt) + IMAGE_GENERATION_TIMEOUT_MS
      : Date.now() + IMAGE_GENERATION_TIMEOUT_MS
    if (Date.now() >= generationDeadline) {
      const error = new Error(IMAGE_GENERATION_TIMEOUT_MESSAGE)
      image.gatewaySubmitPending = false
      if (!submitted.length) throw error
      results[imageIndex] = { status: 'rejected', reason: error }
      persistPendingImages()
      continue
    }
    image.gatewaySubmitPending = true
    persistPendingImages()
    let response: Response | null = null
    let payload: any = null
    let requestError: unknown = null
    let transientSubmitFailure = false
    for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
      try {
        response = await fetchWithTimeout(
          submitUrl,
          {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
          },
          Math.min(IMAGE_ASYNC_SUBMIT_TIMEOUT_MS, Math.max(1, generationDeadline - Date.now())),
        )
        payload = await response.json().catch(() => null)
      } catch (error) {
        requestError = error
      }
      if (response && isTransientGatewayStatus(response.status)) {
        requestError = gatewayTaskError(payload, response.status)
        response = null
      }
      if (!response && isTransientGatewayError(requestError)) {
        transientSubmitFailure = true
        ambiguousSubmission = true
        if (attempt === 2) break
        await waitForGatewayPollRetry(500 * (attempt + 1))
        continue
      }
      break
    }
    if (!response && transientSubmitFailure) {
      try {
        const recovered = await lookupGatewayTaskByIdempotency(
          apiBaseUrl.value,
          idempotencyKey,
          headers,
        )
        if (recovered && gatewayPollUrlForTask(recovered, apiBaseUrl.value)) {
          response = {
            ok: true,
            json: async () => recovered,
          } as Response
          payload = recovered
          requestError = null
        }
      } catch {
        // Preserve the original submission error if recovery also fails.
      }
    }
    if (!response) {
      const reason = requestError instanceof Error
        ? requestError
        : new Error('提交图片任务失败')
      if (transientSubmitFailure) {
        results[imageIndex] = {
          status: 'rejected',
          reason: new ImageSubmissionUnconfirmed(),
        }
        continue
      }
      if (!submitted.length) throw reason
      results[imageIndex] = { status: 'rejected', reason }
      continue
    }
    if (response.status === 404) {
      if (!submitted.length && !ambiguousSubmission) {
        for (const pendingImage of pendingImages) {
          pendingImage.gatewaySubmitPending = false
        }
        persistPendingImages()
        return null
      }
      results[imageIndex] = {
        status: 'rejected',
        reason: ambiguousSubmission
          ? new ImageSubmissionUnconfirmed()
          : gatewayTaskError(payload, response.status),
      }
      continue
    }
    if (!response.ok) {
      const error = gatewayTaskError(payload, response.status)
      if (!submitted.length) throw error
      results[imageIndex] = { status: 'rejected', reason: error }
      continue
    }
    const task = gatewayTaskPayload(payload)
    const taskPollUrl = gatewayPollUrlForTask(task, apiBaseUrl.value)
    if (!taskPollUrl) {
      const error = new Error('服务端没有返回图片任务地址')
      if (!submitted.length) throw error
      results[imageIndex] = { status: 'rejected', reason: error }
      continue
    }
    image.gatewayTaskId = String(task.task_id || task.id || '')
    image.gatewayPollUrl = taskPollUrl
    image.taskId = image.gatewayTaskId || image.taskId
    image.gatewaySubmitPending = false
    submitted.push({ image, pollUrl: taskPollUrl })
    persistPendingImages()
  }

  const polled = await Promise.allSettled(
    submitted.map(async (task) => {
      const items = await pollGatewayImageTask(task.pollUrl, headers, {
        isCancelled: () => componentDisposed,
        onPreview: (previewItems) => applyGatewayPreview(task.image, previewItems),
        deadline: Number(task.image.startedAt || 0) > 0
          ? Number(task.image.startedAt) + IMAGE_GENERATION_TIMEOUT_MS
          : undefined,
      })
      const result = {
        status: 'fulfilled' as const,
        value: imageResultWithTaskTiming(items, Date.now(), task.image.startedAt),
      }
      await onResult?.(task.image, result)
      return result.value
    }),
  )
  pendingImages.forEach((image, index) => {
    const unconfirmed = results[index]?.status === 'rejected'
      && results[index].reason instanceof ImageSubmissionUnconfirmed
    if (!image.gatewayPollUrl && !unconfirmed) image.gatewaySubmitPending = false
  })
  persistPendingImages()
  submitted.forEach((task, index) => {
    const imageIndex = pendingImages.indexOf(task.image)
    if (imageIndex >= 0) results[imageIndex] = polled[index]
  })
  return results.map((result) => result || {
    status: 'rejected',
    reason: new Error('图片任务没有返回结果'),
  })
}

async function resumeGatewayGeneration(pendingImages: GeneratedImage[]) {
  if (!selectedKey.value?.key) return
  const owner = captureStudioOwner()
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
    if (!isStudioOwnerCurrent(owner)) return
    resumedGatewayBatches.add(batchId)
    activeGenerations.value += 1
    generating.value = true
    const progress = createGenerationProgress(owner)
    const clearGenerationTimeoutTimer = schedulePendingImagesTimeout(batch, owner)
    try {
      const apiKeyId = batch[0]?.apiKeyId
      const taskKey = apiKeyId
        ? imageCapableKeys.value.find((key) => Number(key.id) === Number(apiKeyId))
        : selectedKey.value
      if (!taskKey?.key) {
        markPendingImagesFailed(batch, new Error('找不到发起这组图片任务时使用的密钥，请重新生成。'), owner)
        errorMessage.value = '找不到发起这组图片任务时使用的密钥，请重新生成。'
        continue
      }
      const headers = { Authorization: `Bearer ${taskKey.key}` }
      const results = await Promise.allSettled(
        batch.map(async (image) => {
          const items = await pollGatewayImageTask(image.gatewayPollUrl!, headers, {
            isCancelled: () => componentDisposed || !isStudioOwnerCurrent(owner),
            onPreview: (previewItems) => applyGatewayPreview(image, previewItems),
            deadline: Number(image.startedAt || 0) > 0
              ? Number(image.startedAt) + IMAGE_GENERATION_TIMEOUT_MS
              : undefined,
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
      if (!isStudioOwnerCurrent(owner)) return
      applyGenerationFailures(batch, results, owner)
      await progress.drain()
      if (progress.stillRunning) {
        markPendingImagesTimedOut(batch, owner)
        errorMessage.value = IMAGE_GENERATION_TIMEOUT_MESSAGE
        continue
      }
      removePendingImages(
        batch.filter((image) => image.pending && !progress.completedIds.has(image.id)),
        owner,
      )
      if (!isStudioOwnerCurrent(owner)) return
      if (progress.generatedCount === 0) {
        errorMessage.value = errorMessageFrom(progress.firstError, '恢复图片生成任务失败')
        continue
      }
      if (progress.firstError) {
        errorMessage.value = errorMessageFrom(progress.firstError, '部分图片生成失败')
      }
    } catch (error) {
      if (error instanceof ImageGenerationWaitCancelled) return
      if (error instanceof ImageGenerationStillRunning) {
        markPendingImagesTimedOut(batch, owner)
        errorMessage.value = error.message
        continue
      }
      markPendingImagesFailed(batch, error, owner)
      if (!isStudioOwnerCurrent(owner)) return
      errorMessage.value = errorMessageFrom(error, '恢复图片生成任务失败')
    } finally {
      clearGenerationTimeoutTimer()
      if (isStudioOwnerCurrent(owner)) {
        resumedGatewayBatches.delete(batchId)
        activeGenerations.value = Math.max(0, activeGenerations.value - 1)
        generating.value = activeGenerations.value > 0
      }
    }
  }
}

async function resumeAmbiguousGatewaySubmissions(pendingImages: GeneratedImage[]) {
  if (!pendingImages.length || !selectedKey.value?.key) return
  const owner = captureStudioOwner()
  const candidates: GeneratedImage[] = []
  const duplicateImages: GeneratedImage[] = []
  const seenTaskIds = new Set<string>()
  for (const image of pendingImages) {
    const taskId = String(image.taskId || '').trim()
    if (!taskId) continue
    if (seenTaskIds.has(taskId)) {
      duplicateImages.push(image)
      continue
    }
    seenTaskIds.add(taskId)
    if (!resumingAmbiguousTaskIDs.has(taskId)) {
      image.taskId = taskId
      candidates.push(image)
    }
  }
  if (duplicateImages.length) removePendingImages(duplicateImages, owner)
  if (!candidates.length) return
  for (const image of candidates) {
    if (image.taskId) resumingAmbiguousTaskIDs.add(image.taskId)
  }
  let remaining = candidates
  try {
    while (remaining.length && isStudioOwnerCurrent(owner)) {
      const recovered = new Set<GeneratedImage>()
      await Promise.allSettled(remaining.map(async (image) => {
        if (!image.taskId) return
        const taskKey = image.apiKeyId
          ? imageCapableKeys.value.find((key) => Number(key.id) === Number(image.apiKeyId))
          : selectedKey.value
        if (!taskKey?.key) return
        const task = await lookupGatewayTaskByIdempotency(
          apiBaseUrl.value,
          image.taskId,
          { Authorization: `Bearer ${taskKey.key}` },
        )
        const pollUrl = gatewayPollUrlForTask(task, apiBaseUrl.value)
        if (!isStudioOwnerCurrent(owner) || !pollUrl) return
        image.gatewayTaskId = String(task?.task_id || task?.id || image.taskId)
        image.gatewayPollUrl = pollUrl
        image.gatewaySubmitPending = false
        recovered.add(image)
      }))
      if (recovered.size) {
        persistPendingImages()
        void resumeGatewayGeneration(Array.from(recovered))
      }
      remaining = remaining.filter((image) => !recovered.has(image))
      if (!remaining.length || !isStudioOwnerCurrent(owner)) break
      const deadline = Math.min(...remaining.map((image) => (
        Number(image.startedAt || 0) > 0
          ? Number(image.startedAt) + IMAGE_GENERATION_TIMEOUT_MS
          : Date.now() + IMAGE_GENERATION_TIMEOUT_MS
      )))
      if (Date.now() >= deadline) {
        markPendingImagesTimedOut(remaining, owner)
        break
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
    }
  } finally {
    for (const image of candidates) {
      if (image.taskId) resumingAmbiguousTaskIDs.delete(image.taskId)
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
    const response = await fetchWithTimeout(
      url,
      { method: 'POST', headers, body },
      IMAGE_GENERATION_TIMEOUT_MS,
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw gatewayTaskError(payload, response.status)
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
  owner?: StudioOwnerSnapshot,
) {
  if (owner && !isStudioOwnerCurrent(owner)) return []
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
  const resizeTargets: Array<{ image: GeneratedImage; source: string }> = []
  const needsLocalResize = Boolean(firstPending?.customSizeRequested)
    && imageNeedsLocalResize(requestedSize, IMAGE_CONSTRAINTS.maxEdge)
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const resultFormat = imageFormatFromResult(item, '', requestedFormat)
    const mime = String(item.mimeType || item.mime_type || imageMIMETypeForFormat(resultFormat))
    const b64 = String(item.b64_json || item.data || '')
    const previewDataURL = String(item.preview_data_url || '')
    const remoteSrc = resolveImageAssetURL(String(item.display_url || item.url || ''))
    const rawSrc = previewDataURL || (b64
      ? `data:${mime};base64,${b64}`
      : remoteSrc)
    if (!rawSrc) continue
    const previewSrc = String(item.preview_data_url || '')
    const actualFormat = imageFormatFromResult(item, rawSrc, requestedFormat)
    const itemCompletedAt = Number(item.__imageTaskCompletedAt || 0)
    const itemDurationMs = Number(item.__imageTaskDurationMs || 0)
    const generatedImage: GeneratedImage = {
      id: nextImageId++,
      title: `生成结果 ${titleStart + index}`,
      src: rawSrc,
      originalSrc: rawSrc,
      thumbSrc: previewSrc || undefined,
      prompt: currentPrompt,
      model: currentModel,
      size: requestedSize,
      format: actualFormat,
      quality: firstPending?.quality || quality.value,
      background: firstPending?.background || background.value,
      customSizeRequested: firstPending?.customSizeRequested,
      meta: `${actualFormat.toUpperCase()} · ${requestedSize} · ${currentModel}`,
      createdAt: Math.floor((itemCompletedAt > 0 ? itemCompletedAt : completedAtMs) / 1000),
      durationMs: itemDurationMs > 0 ? itemDurationMs : fallbackDurationMs,
      taskId: firstPending?.taskId,
      gatewayTaskId: firstPending?.gatewayTaskId,
      gatewayPollUrl: firstPending?.gatewayPollUrl,
      apiKeyId: firstPending?.apiKeyId,
      displayOrder: firstPending?.displayOrder,
      startedAt: firstPending?.startedAt,
    }
    generated.push(generatedImage)
    if (needsLocalResize && actualFormat !== gifFormatOption.value) {
      resizeTargets.push({ image: generatedImage, source: rawSrc })
    }
  }

  const pendingIds = new Set(pendingImages.map((item) => item.id))
  if (owner && !isStudioOwnerCurrent(owner)) return []
  const pendingIndex = images.value.findIndex((item) => pendingIds.has(item.id))
  images.value = images.value.filter((item) => !pendingIds.has(item.id))
  if (pendingIndex >= 0) {
    images.value.splice(Math.min(pendingIndex, images.value.length), 0, ...generated)
  }
  persistPendingImages()

  let localProcessError = ''
  const reportLocalProcessError = (error: string) => {
    if (localProcessError) return
    localProcessError = error
    const message = '本地尺寸处理失败，已保留并显示上游原图。'
    reportVisibleImageStudioError(message)
    appStore.showWarning(message, 6000)
  }
  const processingTasks = resizeTargets.map((target) => {
    return queueImageDisplayProcessing(
      target.image,
      target.source,
      requestedSize,
      requestedFormat,
      owner,
      reportLocalProcessError,
    )
  })

  if (persist) {
    await Promise.all(processingTasks)
    await persistGeneratedImages(generated, currentPrompt, currentModel, { owner })
  }
  return generated
}

async function uploadPreparedImageReferences(
  preparedReferences: PreparedImageReference[],
): Promise<string[]> {
  const urls = new Array<string>(preparedReferences.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(3, preparedReferences.length) },
    async () => {
      while (nextIndex < preparedReferences.length) {
        const index = nextIndex
        nextIndex += 1
        const image = preparedReferences[index]
        image.remoteUrl = await referenceAssetsAPI.uploadBlob('image', image.blob, image.mimeType)
        urls[index] = image.remoteUrl
      }
    },
  )
  try {
    await Promise.all(workers)
    return urls.filter(Boolean)
  } catch {
    // Inline/multipart remains a compatibility fallback when object storage is
    // unavailable or direct-upload CORS is not configured.
    return []
  }
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
  const supported = files.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
  if (supported.length !== files.length) {
    appStore.showWarning('已忽略不支持的参考图，请使用 PNG、JPEG 或 WebP。', 4000)
  }
  if (!supported.length) return

  const epoch = referenceAddEpoch
  referenceAddQueue = referenceAddQueue.then(async () => {
    if (epoch !== referenceAddEpoch) return
    const limit = effectiveReferenceLimit.value
    const available = Math.max(0, limit - references.value.length)
    if (!available) {
      appStore.showWarning(`当前模型最多 ${limit} 张参考图。`, 4000)
      return
    }
    const accepted = supported.slice(0, available)
    if (accepted.length < supported.length) {
      appStore.showWarning(`已保留前 ${available} 张，当前模型最多 ${limit} 张。`, 4000)
    }
    const items: ReferenceItem[] = []
    for (const file of accepted) {
      if (epoch !== referenceAddEpoch) return
      items.push(await readReferenceFile(file))
    }
    if (epoch !== referenceAddEpoch) return
    const remaining = Math.max(0, effectiveReferenceLimit.value - references.value.length)
    references.value.push(...items.slice(0, remaining))
  }).catch((error) => {
    const message = error instanceof Error ? error.message : '参考图读取失败'
    errorMessage.value = message
    appStore.showError(message, 5000)
  })
}

async function readReferenceFile(file: File): Promise<ReferenceItem> {
  const preview = await createReferenceImagePreview(file)
  return {
    id: nextReferenceId++,
    name: file.name || 'reference.png',
    file,
    preview,
  }
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
  const mediaId = imageMediaId(image)
  if (downloadingImageIds.value.has(mediaId)) return
  downloadingImageIds.value.add(mediaId)
  const filename = `${image.title}.${image.format || 'png'}`
  try {
    const id = await galleryIdForDownload(image)
    if (id && galleryBackedIds.value.has(id)) {
      try {
        const direct = await imageStudioGalleryAPI.downloadURL(id)
        const link = document.createElement('a')
        link.href = direct.url
        link.download = direct.filename || filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        return
      } catch (error) {
        console.warn('Signed image download URL failed; falling back to direct fetch', error)
      }
    }
    if (String(image.gatewayTaskId || '').trim()) {
      try {
        const blob = await fetchGatewayTaskOriginalBlob(image, 0)
        saveBlob(blob, filename)
        return
      } catch (error) {
        console.warn('Gateway task original download failed; falling back to gallery stream', error)
      }
    }
    const source = resolveImageAssetURL(image.originalSrc || image.src)
    if (!image.gatewayTaskId) try {
      const response = await fetch(source, {
        credentials: 'omit',
        cache: 'force-cache',
        signal: AbortSignal.timeout(2 * 60 * 1000),
      })
      if (!response.ok) throw new Error(`download failed: ${response.status}`)
      saveBlob(await response.blob(), filename)
      return
    } catch (error) {
      // Cross-origin or private object stores fall back to the authenticated
      // backend stream.
      console.warn('Direct image download failed; falling back to backend stream', error)
    }
    if (id && galleryBackedIds.value.has(id)) {
      try {
        const blob = await imageStudioGalleryAPI.download(id)
        saveBlob(blob, filename)
        return
      } catch (error) {
        console.warn('Backend image download failed', error)
      }
    }
    if (image.gatewayTaskId) {
      throw new Error('原图下载失败，请稍后重试')
    }
    const link = document.createElement('a')
    link.href = imageDownloadURL(image.originalSrc || image.src)
    link.download = filename
    link.click()
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载图片失败'
    reportVisibleImageStudioError(message)
    appStore.showError(message, 5000)
  } finally {
    downloadingImageIds.value.delete(mediaId)
  }
}

function openImageDownloadMenu(event: MouseEvent, image: GeneratedImage) {
  if (image.pending || image.failed) return
  const width = 208
  const height = 78
  imageDownloadMenu.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    image,
  }
}

function closeImageDownloadMenu() {
  imageDownloadMenu.value = null
}

function downloadOriginalFromMenu() {
  const image = imageDownloadMenu.value?.image
  closeImageDownloadMenu()
  if (image) void downloadImage(image)
}

function isImageDownloading(image: GeneratedImage) {
  return downloadingImageIds.value.has(imageMediaId(image))
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.click()
  window.setTimeout(() => window.URL.revokeObjectURL?.(objectUrl), 1000)
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
  if (image.format && formatOptions.value.some((option) => option.value === image.format)) {
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
  const dimensions = image.size ? parseImageSizeValue(image.size) : null
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
  if (!keyId) return
  writeStoredStudioPreferences(localStorage, authStore.user?.id, { keyId })
  notifyCreatorKeyChanged('image', keyId)
})

watch([selectedKeyId, apiBaseUrl, () => selectedKey.value?.key], () => {
  void loadModels()
})

watch(imageModel, (model, previousModel) => {
  if (!model || model === previousModel) return
  resetParametersForModel(model)
  if (referenceLimitIssue.value) {
    appStore.showWarning(referenceLimitIssue.value, 6000)
  } else if (modelQualityIssue.value) {
    appStore.showWarning(modelQualityIssue.value, 6000)
  }
  if (imageModels.value.includes(model)) {
  writeStoredStudioPreferences(localStorage, authStore.user?.id, { model })
  }
})

watch(
  [keys, imageModels, selectedKeyId, imageModel, images],
  () => writeStudioSnapshot(),
  { deep: true, flush: 'post' },
)

watch(
  images,
  (items) => {
    const activeIds = new Set(items.map((image) => imageMediaId(image)))
    for (const id of imageMediaTimeoutIds.keys()) {
      if (activeIds.has(id)) continue
      const timer = imageMediaTimeoutIds.get(id)
      if (timer) clearTimeout(timer)
      imageMediaTimeoutIds.delete(id)
    }
    for (const image of items) armImageMediaTimeout(image)
  },
  { deep: true, flush: 'post' },
)

watch(
  hasActiveImageGeneration,
  (hasActiveGeneration) => {
    if (hasActiveGeneration) startGenerationClock()
    else stopGenerationClock()
    if (!hasActiveGeneration && galleryRefreshDeferred) {
      galleryRefreshDeferred = false
      void Promise.allSettled([loadGallery(), loadStudioQuota()])
    }
  },
  { immediate: true },
)

watch(
  () => authStore.user?.id,
  (userId) => {
    void switchStudioUser(userId)
  },
  { flush: 'sync' },
)

onMounted(() => {
  componentDisposed = false
  document.addEventListener('click', handleSizeOutside)
  document.addEventListener('pointerdown', closeImageDownloadMenu)
  document.addEventListener('keydown', handleSizeEscape)
  document.addEventListener('visibilitychange', handleGalleryVisibilityChange)
  window.addEventListener(IMAGE_STUDIO_GALLERY_CHANGED_EVENT, refreshGalleryAfterExternalChange)
  window.addEventListener('online', resumeAmbiguousTasksOnOnline)
  applyInspirationFromRoute()
  startExpiryPruneTimer()
  startGalleryURLRefreshTimer()
  void loadData()
})
onActivated(() => {
  componentDisposed = false
  const currentUserId = authStore.user?.id == null ? '' : String(authStore.user.id)
  if (currentUserId !== studioStateOwnerId.value) {
    void switchStudioUser(currentUserId)
    return
  }
  if (activeGenerations.value > 0 || activeImageTaskCount.value > 0) {
    startGenerationClock()
  }
  if (studioLoadedOnce) refreshGalleryAfterExternalChange()
  startExpiryPruneTimer()
  startGalleryURLRefreshTimer()
  applyInspirationFromRoute()
  const restored = images.value.filter((item) => item.pending && item.taskId && !item.gatewayPollUrl && !item.gatewaySubmitPending)
  if (restored.length) void resumePersistentGeneration(restored)
  const ambiguousPending = images.value.filter((item) => item.pending && item.gatewaySubmitPending && !item.gatewayPollUrl)
  if (ambiguousPending.length) void resumeAmbiguousGatewaySubmissions(ambiguousPending)
  const gatewayPending = images.value.filter((item) => item.pending && item.gatewayPollUrl)
  if (gatewayPending.length) void resumeGatewayGeneration(gatewayPending)
})
onDeactivated(() => {
  stopGenerationClock()
  stopExpiryPruneTimer()
  stopGalleryURLRefreshTimer()
  if (studioStateOwnerId.value) writeStudioSnapshot(studioStateOwnerId.value)
})
onBeforeUnmount(() => {
  componentDisposed = true
  stopGenerationClock()
  stopExpiryPruneTimer()
  stopGalleryURLRefreshTimer()
  if (studioStateOwnerId.value) writeStudioSnapshot(studioStateOwnerId.value)
  document.removeEventListener('click', handleSizeOutside)
  document.removeEventListener('pointerdown', closeImageDownloadMenu)
  document.removeEventListener('keydown', handleSizeEscape)
  document.removeEventListener('visibilitychange', handleGalleryVisibilityChange)
  window.removeEventListener(IMAGE_STUDIO_GALLERY_CHANGED_EVENT, refreshGalleryAfterExternalChange)
  window.removeEventListener('online', resumeAmbiguousTasksOnOnline)
  for (const timer of imageMediaTimeoutIds.values()) {
    clearTimeout(timer)
  }
  imageMediaTimeoutIds.clear()
  cancelPendingImageDisplayProcessing()
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
  position: relative;
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

.image-composer__segmented--four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.image-pending-card--preview {
  background: rgb(15 23 42);
  color: white;
}

.image-pending-card__preview {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  object-fit: cover;
  opacity: 0.88;
}

.image-pending-card__preview-status {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 0.75rem;
  background: rgb(15 23 42 / 0.72);
  padding: 0.7rem 0.9rem;
  text-align: center;
  backdrop-filter: blur(8px);
}

.image-pending-card__preview-status small {
  color: rgb(226 232 240);
}

.image-pending-card__timer {
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  color: rgb(13 148 136) !important;
}

.image-failure-card {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  overflow: hidden;
  background: linear-gradient(145deg, rgb(254 242 242), rgb(255 247 237));
  padding: 1.1rem;
  text-align: center;
  color: rgb(153 27 27);
}

.image-failure-card strong {
  font-size: 0.875rem;
  font-weight: 700;
}

.image-failure-card p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  font-size: 0.75rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.image-failure-card small {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: rgb(185 28 28 / 0.75);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.image-failure-retry {
  display: inline-flex;
  height: 2rem;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  border: 1px solid rgb(252 165 165);
  border-radius: 0.5rem;
  background: rgb(254 242 242 / 0.9);
  padding: 0 0.65rem;
  color: rgb(185 28 28);
  font-size: 0.75rem;
  font-weight: 650;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.image-failure-retry:hover:not(:disabled) {
  border-color: rgb(248 113 113);
  background: rgb(254 226 226);
}

.image-failure-retry:disabled {
  cursor: wait;
  opacity: 0.65;
}

:global(.dark .image-failure-card) {
  background: linear-gradient(145deg, rgb(69 10 10 / 0.45), rgb(41 22 10 / 0.55));
  color: rgb(254 202 202);
}

:global(.dark .image-failure-card small) {
  color: rgb(254 202 202 / 0.7);
}

:global(.dark .image-failure-retry) {
  border-color: rgb(153 27 27 / 0.7);
  background: rgb(127 29 29 / 0.28);
  color: rgb(254 202 202);
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

.image-detail-dialog__media-state--inline {
  inset: auto 1rem 1rem auto;
  z-index: 2;
  width: fit-content;
  max-width: calc(100% - 2rem);
  flex-direction: row;
  gap: 0.55rem;
  border: 1px solid rgb(203 213 225);
  border-radius: 999px;
  background: rgb(248 250 252 / 0.92);
  padding: 0.5rem 0.75rem;
  box-shadow: 0 8px 24px rgb(15 23 42 / 0.12);
  backdrop-filter: blur(8px);
}

.image-detail-dialog__media-state--inline small {
  display: none;
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
  align-items: stretch;
  gap: 1rem;
}

.image-result-card__media {
  aspect-ratio: 16 / 10;
  flex: none;
}

.image-result-card {
  content-visibility: auto;
  contain-intrinsic-size: 20rem;
}

.image-result-card__media img {
  width: 100%;
  height: 100%;
}

.image-studio .studio-page__results article {
  display: flex;
  height: 100%;
  flex-direction: column;
  border-radius: 0.55rem;
  background: rgb(255 255 255);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.03);
}

.image-result-card__footer {
  min-height: 4.25rem;
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
