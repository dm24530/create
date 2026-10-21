<template>
  <AppLayout>
    <div class="studio-library">
      <div class="studio-library__nav xl:hidden"><StudioNav /></div>
      <div class="studio-library__content inspiration">
      <header class="inspiration__header">
        <div>
          <h1>视频灵感库</h1>
        </div>
        <div class="inspiration__header-actions">
          <div class="segmented" role="tablist" aria-label="灵感来源">
            <button
              type="button"
              role="tab"
              class="segmented__item"
              :class="{ 'segmented__item--active': source === 'library' }"
              :aria-selected="source === 'library'"
              data-testid="inspiration-source-library"
              @click="switchSource('library')"
            >
              作品库
            </button>
            <button
              type="button"
              role="tab"
              class="segmented__item"
              :class="{ 'segmented__item--active': source === 'curated' }"
              :aria-selected="source === 'curated'"
              data-testid="inspiration-source-curated"
              @click="switchSource('curated')"
            >
              镜头模板
            </button>
          </div>
          <RouterLink class="toolbar-link" to="/video-studio">
            <Icon name="play" size="sm" />
            <span>去视频工作台</span>
          </RouterLink>
        </div>
      </header>

      <template v-if="source === 'curated'">
        <div class="inspiration__filters" role="tablist" aria-label="灵感分类">
          <button
            type="button"
            class="filter-chip"
            :class="{ 'filter-chip--active': activeCategory === '' }"
            data-testid="inspiration-category-all"
            @click="activeCategory = ''"
          >
            全部
          </button>
          <button
            v-for="category in categories"
            :key="category"
            type="button"
            class="filter-chip"
            :class="{ 'filter-chip--active': activeCategory === category }"
            :data-testid="`inspiration-category-${category}`"
            @click="activeCategory = category"
          >
            {{ category }}
          </button>
        </div>

        <div class="inspiration__grid">
          <VideoInspirationTile
            v-for="template in filteredTemplates"
            :key="template.slug"
            :test-id="`template-${template.slug}`"
            :image-url="templatePoster(template)"
            :media-style="posterStyle(template)"
            :title="template.title"
            :eyebrow="template.category"
            :summary="template.summary"
            :spec="`${template.durationSeconds}s · ${template.aspectRatio}`"
            :badge="template.storyboard ? '分镜预览' : ''"
            :action-label="`查看「${template.title}」的大图与提示词`"
            @open="openTemplate(template)"
            @image-error="markPosterFailed(template.slug)"
          />
        </div>
      </template>

      <template v-else-if="source === 'online'">
        <div class="online-bar">
          <div class="online-bar__controls">
            <div class="segmented segmented--compact" role="tablist" aria-label="排序">
              <button
                v-for="option in sortOptions"
                :key="option.value"
                type="button"
                role="tab"
                class="segmented__item"
                :class="{ 'segmented__item--active': onlineQuery.sort === option.value }"
                :data-testid="`online-sort-${option.value}`"
                @click="setOnlineQuery({ sort: option.value })"
              >
                {{ option.label }}
              </button>
            </div>
            <div class="segmented segmented--compact" role="tablist" aria-label="时间范围">
              <button
                v-for="option in periodOptions"
                :key="option.value"
                type="button"
                role="tab"
                class="segmented__item"
                :class="{ 'segmented__item--active': onlineQuery.period === option.value }"
                :data-testid="`online-period-${option.value}`"
                @click="setOnlineQuery({ period: option.value })"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div class="online-bar__actions">
            <span class="online-bar__hint" data-testid="online-fetched-at">{{ onlineFetchedLabel }}</span>
            <button
              type="button"
              class="secondary-button"
              data-testid="online-refresh"
              :disabled="onlineLoading"
              @click="loadOnline(true)"
            >
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': onlineLoading }" />
              <span>{{ onlineLoading ? '加载中' : '换一批' }}</span>
            </button>
          </div>
        </div>

        <div v-if="onlineError" class="online-error" data-testid="online-error">
          <Icon name="exclamationCircle" size="sm" />
          <span>{{ onlineError }}</span>
        </div>

        <div v-if="onlineLoading && !onlineItems.length" class="online-empty">
          <span class="video-card__spinner" aria-hidden="true"></span>
          <p>正在拉取在线灵感…</p>
        </div>

        <div v-else-if="!onlineItems.length && !onlineError" class="online-empty">
          <p>暂时没有拉到可用的灵感，稍后再试。</p>
        </div>

        <div v-else class="inspiration__grid">
          <VideoInspirationTile
            v-for="item in onlineItems"
            :key="item.id"
            :test-id="`online-${item.id}`"
            :image-url="item.posterUrl"
            :media-style="onlineFrameStyle(item)"
            :title="item.prompt"
            :eyebrow="item.model || '未知模型'"
            :summary="`本站精选 · ${item.likes} 赞`"
            :spec="`视频 · ${item.width}×${item.height}`"
            badge="视频灵感"
            type-icon="play"
            :action-label="`查看在线视频灵感与提示词`"
            @open="openOnline(item)"
          />
        </div>
      </template>

      <template v-else>
        <!-- 作品库：自家灵感站的视频提示词数据，服务端筛选分页 -->
        <div class="online-bar">
          <div class="online-bar__controls">
            <label class="inline-field">
              <span>模型</span>
              <ImageStudioSelect
                v-model="libraryQuery.model"
                data-testid="library-model-select"
                :options="libraryModelOptions"
                @update:modelValue="reloadLibrary"
              />
            </label>
            <label class="inline-field">
              <span>分类</span>
              <ImageStudioSelect
                v-model="libraryQuery.category"
                data-testid="library-category-select"
                :options="libraryCategoryOptions"
                @update:modelValue="reloadLibrary"
              />
            </label>
            <div class="inline-field">
              <span>搜索</span>
              <input
                v-model="libraryQuery.keyword"
                type="search"
                class="text-input"
                placeholder="关键词，如 product、城市"
                data-testid="library-search"
                @keydown.enter.prevent="reloadLibrary"
              />
            </div>
            <button type="button" class="secondary-button search-submit" data-testid="library-search-button" @click="reloadLibrary">
              <Icon name="search" size="sm" />
              <span>搜索</span>
            </button>
          </div>
          <div class="online-bar__actions">
            <span class="online-bar__hint" data-testid="library-summary">{{ librarySummary }}</span>
            <button
              type="button"
              class="secondary-button"
              data-testid="library-refresh"
              :disabled="libraryLoading"
              @click="loadLibrary({ refresh: true })"
            >
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': libraryLoading }" />
              <span>刷新</span>
            </button>
          </div>
        </div>

        <div v-if="onlineFallbackNotice" class="online-fallback" data-testid="online-fallback">
          <Icon name="exclamationCircle" size="sm" />
          <span>{{ onlineFallbackNotice }}</span>
          <button type="button" class="online-fallback__close" aria-label="关闭提示" @click="onlineFallbackNotice = ''">
            <Icon name="x" size="xs" />
          </button>
        </div>

        <div v-if="libraryError" class="online-error" data-testid="library-error">
          <Icon name="exclamationCircle" size="sm" />
          <span>{{ libraryError }}</span>
        </div>

        <div v-if="libraryLoading && !libraryItems.length" class="online-empty">
          <span class="video-card__spinner" aria-hidden="true"></span>
          <p>正在加载作品库…</p>
        </div>

        <div v-else-if="!libraryItems.length && !libraryError" class="online-empty">
          <p>没有匹配的作品，试试换个模型或关键词。</p>
        </div>

        <template v-else>
          <div class="inspiration__grid">
            <VideoInspirationTile
              v-for="item in libraryItems"
              :key="item.id"
              :test-id="`library-${item.id}`"
              :image-url="libraryCoverUrl(item)"
              :media-style="libraryFrameStyle(item)"
              :title="item.title"
              :eyebrow="item.model || item.category || '作品'"
              :summary="item.category || '本站作品'"
              :spec="librarySpec(item)"
              :badge="libraryCoverUrl(item) ? '分镜预览' : ''"
              :action-label="`查看「${item.title}」的大图与提示词`"
              @open="openLibraryItem(item)"
              @image-error="markLibraryCoverFailed(item.id)"
            />
          </div>

          <div v-if="libraryHasMore" class="library-more">
            <button
              type="button"
              class="secondary-button"
              data-testid="library-load-more"
              :disabled="libraryLoading"
              @click="loadLibrary({ append: true })"
            >
              <Icon name="arrowDown" size="sm" />
              <span>{{ libraryLoading ? '加载中' : '加载更多' }}</span>
            </button>
          </div>
        </template>
      </template>
    </div>

    <BaseDialog
      :show="!!active"
      :title="active?.title || '镜头模板'"
      width="full"
      :close-on-click-outside="true"
      @close="active = null"
    >
      <div v-if="active" class="detail">
        <div class="detail__media">
          <video
            v-if="active.mediaType === 'video' && active.mediaUrl"
            :src="active.mediaUrl"
            :poster="active.posterUrl || undefined"
            class="detail__video"
            controls
            playsinline
            preload="metadata"
            data-testid="inspiration-video"
          />
          <img
            v-else-if="active.mediaType === 'image' && active.mediaUrl"
            :src="active.mediaUrl"
            alt=""
            class="detail__image"
            data-testid="inspiration-image"
          />
          <span v-else class="detail__placeholder" :style="active.placeholderStyle">
            <img
              v-if="active.posterPreviewUrl"
              :src="active.posterPreviewUrl"
              alt=""
              class="detail__placeholder-image"
            />
            <span v-if="active.posterPreviewUrl" class="detail__badge">分镜预览</span>
          </span>
        </div>

        <section class="detail__panel">
          <div class="detail__section-head">
            <span>提示词</span>
            <button
              type="button"
              class="detail__copy"
              data-testid="inspiration-copy"
              @click="copyPrompt(active.prompt)"
            >
              <Icon name="copy" size="xs" />
              <span>复制</span>
            </button>
          </div>
          <p class="detail__prompt">{{ active.prompt }}</p>

          <template v-if="active.negativePrompt">
            <div class="detail__section-head">
              <span>反向提示词</span>
            </div>
            <p class="detail__prompt detail__prompt--muted">{{ active.negativePrompt }}</p>
          </template>

          <dl class="detail__meta">
            <div v-for="row in active.meta" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>

          <template v-if="active.tips">
            <div class="detail__section-head">
              <span>参数建议</span>
            </div>
            <p class="detail__hint">{{ active.tips }}</p>
          </template>

          <template v-if="active.checkpoints">
            <div class="detail__section-head">
              <span>验收要点</span>
            </div>
            <p class="detail__hint">{{ active.checkpoints }}</p>
          </template>

          <template v-if="active.requirements.length">
            <div class="detail__section-head">
              <span>需要的参考素材</span>
            </div>
            <ul class="detail__requirements">
              <li v-for="item in active.requirements" :key="item">{{ item }}</li>
            </ul>
          </template>
        </section>
      </div>

      <template #footer>
        <div class="detail__footer">
          <button type="button" class="secondary-button" @click="active && copyPrompt(active.prompt)">
            <Icon name="copy" size="sm" />
            <span>复制提示词</span>
          </button>
          <button type="button" class="primary-button" @click="active && useActive()">
            <Icon name="sparkles" size="sm" />
            <span>带入工作台</span>
          </button>
        </div>
      </template>
    </BaseDialog>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import StudioNav from '@/components/layout/StudioNav.vue'
import { useClipboard } from '@/composables/useClipboard'
import ImageStudioSelect from '../image-studio/ImageStudioSelect.vue'
import VideoInspirationTile from './VideoInspirationTile.vue'

import {
  VIDEO_INSPIRATION_TEMPLATES,
  videoInspirationCategories,
  type OnlineInspirationItem,
  type VideoInspirationTemplate,
} from './videoInspiration'
import { fetchInspirationLibrary, fetchOnlineInspirationFeed, type InspirationLibraryItem } from './videoArchiveApi'
import { inspirationMediaProxyUrl } from './videoArchiveApi'

interface MetaRow {
  label: string
  value: string
}

interface ActiveInspiration {
  kind: 'curated' | 'online'
  title: string
  prompt: string
  negativePrompt: string
  mediaType: 'none' | 'image' | 'video'
  mediaUrl: string
  posterUrl: string
  meta: MetaRow[]
  tips: string
  checkpoints: string
  requirements: string[]
  placeholderStyle: Record<string, string>
  posterPreviewUrl: string
  template: VideoInspirationTemplate | null
}

const PENDING_PROMPT_STORAGE_KEY = 'sub2api:video-studio:pending-prompt'

const router = useRouter()
const { copyToClipboard } = useClipboard()

const source = ref<'curated' | 'online' | 'library'>('library')
const activeCategory = ref('')
const active = ref<ActiveInspiration | null>(null)
// 分镜图取不到时记下来，退回色板底图，避免一直重试破图。
const failedPosters = ref<Record<string, boolean>>({})

const onlineItems = ref<OnlineInspirationItem[]>([])
const onlineLoading = ref(false)
const onlineError = ref('')
const onlineFallbackNotice = ref('')
const onlineFetchedAt = ref(0)
let onlineAbort: AbortController | null = null

// 视频灵感只展示视频方向，避免和独立的图片灵感入口重复。
const onlineQuery = reactive<{ sort: 'newest' | 'reactions'; period: 'day' | 'week' | 'month' | 'all' }>({
  sort: 'newest',
  period: 'week',
})
const sortOptions = [
  { value: 'newest' as const, label: '最新' },
  { value: 'reactions' as const, label: '最热' },
]
const periodOptions = [
  { value: 'day' as const, label: '今天' },
  { value: 'week' as const, label: '本周' },
  { value: 'month' as const, label: '本月' },
  { value: 'all' as const, label: '全部' },
]
const onlineFetchedLabel = computed(() => {
  if (onlineLoading.value) return '正在拉取…'
  if (!onlineFetchedAt.value) return '本站灵感库'
  const date = new Date(onlineFetchedAt.value * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `更新于 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

/* ------------------------------ 作品库 ------------------------------ */

const libraryItems = ref<InspirationLibraryItem[]>([])
const libraryLoading = ref(false)
const libraryError = ref('')
const libraryTotal = ref(0)
const libraryHasMore = ref(false)
const libraryPageNumber = ref(1)
const libraryFetchedAt = ref(0)
const libraryStale = ref(false)
const libraryModels = ref<string[]>([])
const libraryCategories = ref<string[]>([])
const libraryFailedCovers = ref<Record<string, boolean>>({})
const libraryQuery = reactive<{ model: string; category: string; keyword: string }>({
  model: 'all',
  category: 'all',
  keyword: '',
})
const libraryModelOptions = computed(() => [
  { value: 'all', label: '全部模型' },
  ...libraryModels.value.map((model) => ({ value: model, label: model })),
])
const libraryCategoryOptions = computed(() => [
  { value: 'all', label: '全部分类' },
  ...libraryCategories.value.map((category) => ({ value: category, label: category })),
])
const librarySummary = computed(() => {
  if (libraryLoading.value && !libraryItems.value.length) return '正在加载…'
  const parts = [`共 ${libraryTotal.value} 条`]
  if (libraryFetchedAt.value) {
    const date = new Date(libraryFetchedAt.value * 1000)
    const pad = (value: number) => String(value).padStart(2, '0')
    parts.push(`同步于 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`)
  }
  if (libraryStale.value) parts.push('（源暂时不可用，展示上次快照）')
  return parts.join(' · ')
})

const categories = videoInspirationCategories()
const filteredTemplates = computed(() =>
  activeCategory.value
    ? VIDEO_INSPIRATION_TEMPLATES.filter((item) => item.category === activeCategory.value)
    : VIDEO_INSPIRATION_TEMPLATES,
)

// 无内置媒体的模板用一块分镜色板占位，左边视觉、右边提示词的版式保持一致。
function posterStyle(template: VideoInspirationTemplate) {
  return {
    aspectRatio: template.aspectRatio.replace(':', ' / '),
    background: `linear-gradient(140deg, hsl(${template.hue} 62% 22%), hsl(${(template.hue + 40) % 360} 48% 12%))`,
  }
}

function templatePoster(template: VideoInspirationTemplate): string {
  if (!template.storyboard || failedPosters.value[template.slug]) return ''
  return inspirationMediaProxyUrl(template.storyboard)
}

function markPosterFailed(slug: string) {
  failedPosters.value = { ...failedPosters.value, [slug]: true }
}

function onlineFrameStyle(item: OnlineInspirationItem) {
  const ratio = item.width > 0 && item.height > 0
    ? `${item.width} / ${item.height}`
    : '16 / 9'
  return {
    aspectRatio: ratio,
    background: 'rgb(15 23 42)',
  }
}

function requirementList(template: VideoInspirationTemplate): string[] {
  const list: string[] = []
  if (template.requiresImages > 0) list.push(`${template.requiresImages} 张参考图`)
  if (template.requiresVideo) list.push('1 个参考视频')
  if (template.requiresAudio) list.push('开启生成音频')
  return list
}

function openTemplate(template: VideoInspirationTemplate) {
  active.value = {
    kind: 'curated',
    title: template.title,
    prompt: template.prompt,
    negativePrompt: '',
    // 有分镜图就按图片展示（不是播放器）；没有就留色板。
    mediaType: template.storyboard ? 'image' : 'none',
    mediaUrl: templatePoster(template),
    posterUrl: '',
    meta: [
      { label: '分类', value: template.category },
      { label: '时长', value: `${template.durationSeconds} 秒` },
      { label: '画质', value: template.resolution },
      { label: '画幅', value: template.aspectRatio },
    ],
    tips: template.tips,
    checkpoints: template.checkpoints,
    requirements: requirementList(template),
    placeholderStyle: posterStyle(template),
    posterPreviewUrl: templatePoster(template),
    template,
  }
}

function openOnline(item: OnlineInspirationItem) {
  active.value = {
    kind: 'online',
    title: item.mediaType === 'video' ? '在线视频灵感' : '在线图片灵感',
    prompt: item.prompt,
    negativePrompt: item.negativePrompt,
    mediaType: item.mediaType,
    mediaUrl: item.mediaUrl,
    posterUrl: item.posterUrl,
    meta: [
      { label: '模型', value: item.model || '未知' },
      { label: '尺寸', value: `${item.width}×${item.height}` },
      { label: '类型', value: item.mediaType === 'video' ? '视频' : '图片' },
    ],
    tips: '',
    checkpoints: '',
    requirements: [],
    placeholderStyle: onlineFrameStyle(item),
    posterPreviewUrl: '',
    template: null,
  }
}

async function loadOnline(refresh = false) {
  onlineAbort?.abort()
  const controller = new AbortController()
  onlineAbort = controller
  onlineLoading.value = true
  onlineError.value = ''
  onlineFallbackNotice.value = ''
  try {
    const feed = await fetchOnlineInspirationFeed({
      mediaType: 'video',
      sort: onlineQuery.sort,
      period: onlineQuery.period,
      limit: 48,
      refresh,
    })
    if (controller.signal.aborted) return
    onlineFetchedAt.value = feed.fetched_at
    onlineItems.value = feed.items
      .filter((entry) => entry.media_type !== 'image')
      .map((entry) => ({
        id: String(entry.id),
        mediaType: 'video' as const,
        mediaUrl: String(entry.media_url ?? ''),
        posterUrl: String(entry.poster_url ?? ''),
        prompt: String(entry.prompt ?? ''),
        negativePrompt: String(entry.negative_prompt ?? ''),
        model: String(entry.model ?? ''),
        author: String(entry.author ?? ''),
        width: Number(entry.width ?? 0) || 0,
        height: Number(entry.height ?? 0) || 0,
        likes: Number(entry.likes ?? 0) || 0,
      }))
    if (!onlineItems.value.length) {
      onlineError.value = '这个时间范围里没有拉到带提示词的作品，换个时间范围或点「换一批」。'
    }
  } catch (error) {
    if (controller.signal.aborted) return
    console.error('Failed to load online inspiration:', error)
    onlineFallbackNotice.value = '灵感服务暂时不可用，已自动切换到作品库，稍后可以再试。'
    onlineError.value = ''
    source.value = 'library'
    if (!libraryItems.value.length && !libraryLoading.value) {
      void loadLibrary()
    }
  } finally {
    if (!controller.signal.aborted) onlineLoading.value = false
  }
}

function setOnlineQuery(patch: Partial<typeof onlineQuery>) {
  Object.assign(onlineQuery, patch)
  void loadOnline()
}

function switchSource(next: 'curated' | 'online' | 'library') {
  source.value = next
  if (next === 'online' && !onlineItems.value.length && !onlineLoading.value) void loadOnline()
  if (next === 'library' && !libraryItems.value.length && !libraryLoading.value) void loadLibrary()
}

/* ------------------------------ 作品库 ------------------------------ */

function libraryFrameStyle(item: InspirationLibraryItem) {
  const ratio = item.width > 0 && item.height > 0
    ? `${item.width} / ${item.height}`
    : normalizeAspectRatio(item.aspect_ratio)
  return { aspectRatio: ratio, background: 'rgb(15 23 42)' }
}

function normalizeAspectRatio(value: string): string {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/)
  return match ? `${match[1]} / ${match[2]}` : '16 / 9'
}

function librarySpec(item: InspirationLibraryItem): string {
  if (item.type === 'image') return item.width > 0 ? `图片 · ${item.width}×${item.height}` : '图片'
  return ['视频', item.duration_seconds ? `${item.duration_seconds}s` : '', item.aspect_ratio, item.resolution]
    .filter(Boolean)
    .join(' · ')
}

function markLibraryCoverFailed(id: string) {
  libraryFailedCovers.value = { ...libraryFailedCovers.value, [id]: true }
}

function libraryCoverUrl(item: InspirationLibraryItem): string {
  if (!item.cover_url || libraryFailedCovers.value[item.id]) return ''
  return item.cover_url
}

function reloadLibrary() {
  void loadLibrary()
}

async function loadLibrary(options: { append?: boolean; refresh?: boolean } = {}) {
  const append = options.append === true
  const page = append ? libraryPageNumber.value + 1 : 1
  libraryLoading.value = true
  libraryError.value = ''
  try {
    const result = await fetchInspirationLibrary({
      type: 'video',
      model: libraryQuery.model,
      category: libraryQuery.category,
      keyword: libraryQuery.keyword,
      page,
      pageSize: 60,
      refresh: options.refresh === true,
    })
    const videoItems = result.items.filter((item) => item.type === 'video')
    libraryItems.value = append ? [...libraryItems.value, ...videoItems] : videoItems
    libraryPageNumber.value = page
    libraryTotal.value = result.total
    libraryHasMore.value = result.has_more
    libraryFetchedAt.value = result.fetched_at
    libraryStale.value = result.stale
    // 模型/分类候选由服务端的整份快照给出，换类型后会一起更新。
    if (result.models.length) libraryModels.value = result.models
    if (result.categories.length) libraryCategories.value = result.categories
    if (!libraryItems.value.length) libraryError.value = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    libraryError.value = message
      ? `加载作品库失败：${message}`
      : '加载作品库失败：请检查服务器能否访问灵感站。'
  } finally {
    libraryLoading.value = false
  }
}

function openLibraryItem(item: InspirationLibraryItem) {
  active.value = {
    kind: 'online',
    title: item.title || (item.type === 'video' ? '视频提示词' : '图片灵感'),
    prompt: item.prompt,
    negativePrompt: '',
    mediaType: item.type === 'image' && libraryCoverUrl(item) ? 'image' : 'none',
    mediaUrl: item.type === 'image' ? libraryCoverUrl(item) : '',
    posterUrl: libraryCoverUrl(item),
    meta: [
      { label: '模型', value: item.model || '未知' },
      { label: '分类', value: item.category || '—' },
      ...(item.type === 'image'
        ? [{ label: '尺寸', value: `${item.width}×${item.height}` }]
        : [
            { label: '时长', value: `${item.duration_seconds} 秒` },
            { label: '画幅', value: item.aspect_ratio || '—' },
            { label: '画质', value: item.resolution || '—' },
          ]),
    ],
    tips: '',
    checkpoints: '',
    requirements: [],
    placeholderStyle: libraryFrameStyle(item),
    // 视频提示词条目只有文字，左侧用它的封面/色板占位。
    posterPreviewUrl: item.type === 'image' ? '' : libraryCoverUrl(item),
    template: null,
  }
}

// 在线灵感没有本地参数，只把提示词交给工作台，避免长提示词塞进 URL。
function handoffPrompt(prompt: string) {
  try {
    sessionStorage.setItem(PENDING_PROMPT_STORAGE_KEY, prompt)
  } catch {
    // 浏览器存储不可用时退化成只跳转。
  }
  void router.push({ path: '/video-studio' })
}

function useTemplate(template: VideoInspirationTemplate) {
  active.value = null
  void router.push({ path: '/video-studio', query: { inspiration: template.slug } })
}

function useActive() {
  const current = active.value
  if (!current) return
  if (current.kind === 'curated' && current.template) {
    useTemplate(current.template)
    return
  }
  active.value = null
  handoffPrompt(current.prompt)
}

async function copyPrompt(prompt: string) {
  await copyToClipboard(prompt, '提示词已复制')
}

// 离开页面时取消还在飞的请求，避免回来后把旧结果覆盖到新列表上。
onBeforeUnmount(() => {
  onlineAbort?.abort()
})

onMounted(() => {
  if (source.value === 'library' && !libraryItems.value.length && !libraryLoading.value) {
    void loadLibrary()
  }
})
</script>

<style scoped>
.inspiration {
  display: flex;
  width: 100%;
  /* 与图片工作台保持同宽。 */
  max-width: 120rem;
  margin: 0 auto;
  flex-direction: column;
  gap: 1rem;
}

.inspiration__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.inspiration__header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: rgb(17 24 39);
}

.inspiration__header p {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: rgb(107 114 128);
}

.inspiration__header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.segmented {
  display: inline-flex;
  gap: 0.25rem;
  border-radius: 0.75rem;
  background: rgb(241 245 249);
  padding: 0.25rem;
}

.segmented__item {
  border-radius: 0.5rem;
  padding: 0.35rem 0.8rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
}

.segmented__item--active {
  background: rgb(255 255 255);
  color: rgb(173 74 41);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
}

.toolbar-link {
  display: inline-flex;
  height: 2.4rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.85);
  padding: 0 0.75rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
  text-decoration: none;
}

.toolbar-link:hover {
  border-color: rgb(232 121 78);
  color: rgb(173 74 41);
}

.inspiration__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.filter-chip {
  border: 1px solid rgb(226 232 240);
  border-radius: 9999px;
  background: rgb(255 255 255);
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
}

.filter-chip:hover {
  border-color: rgb(232 121 78);
  color: rgb(173 74 41);
}

.filter-chip--active {
  border-color: rgb(232 121 78);
  background: rgb(255 244 238);
  color: rgb(173 74 41);
}

.online-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.online-bar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.online-bar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.segmented--compact .segmented__item {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.online-bar__hint {
  font-size: 0.8rem;
  color: rgb(107 114 128);
}

.inline-field {
  display: inline-flex;
  height: 2.35rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.6rem;
  background: rgb(255 255 255);
  padding: 0 0.55rem;
  font-size: 0.75rem;
  color: rgb(107 114 128);
}

.inline-field > span {
  white-space: nowrap;
  font-size: 0.75rem;
}

.inline-field:focus-within {
  border-color: rgb(232 121 78);
}

.inline-field :deep(.studio-select__trigger) {
  height: 2.05rem;
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.inline-field :deep(.studio-select__trigger:hover),
.inline-field :deep(.studio-select--open .studio-select__trigger) {
  border: 0;
  box-shadow: none;
}

.inline-field .text-input {
  height: 2.05rem;
  min-width: 11rem;
  border: 0;
  background: transparent;
  padding: 0;
}

.library-more {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 0.25rem;
}

.library-more .secondary-button {
  flex: 0 0 auto;
  padding: 0 1rem;
}

:global(.dark .inline-field) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(167 159 148);
}

:global(.dark .inline-field .text-input) {
  border: 0;
  background: transparent;
  color: rgb(242 237 229);
}

.online-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid rgb(254 202 202);
  border-radius: 0.5rem;
  background: rgb(254 242 242);
  padding: 0.5rem 0.75rem;
  font-size: 0.82rem;
  color: rgb(185 28 28);
}

.online-fallback {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid rgb(253 230 138);
  border-radius: 0.55rem;
  background: rgb(254 252 232);
  padding: 0.55rem 0.75rem;
  font-size: 0.82rem;
  color: rgb(146 64 14);
}

.online-fallback__close {
  margin-left: auto;
  border-radius: 0.35rem;
  padding: 0.2rem;
}

.online-fallback__close:hover {
  background: rgb(254 240 138 / 0.55);
}

.online-empty {
  display: flex;
  min-height: 12rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  font-size: 0.85rem;
  color: rgb(107 114 128);
}

.video-card__spinner {
  height: 1.6rem;
  width: 1.6rem;
  border-radius: 9999px;
  border: 2px solid rgb(148 163 184 / 0.35);
  border-top-color: rgb(45 212 191);
  animation: inspiration-spin 0.9s linear infinite;
}

@keyframes inspiration-spin {
  to {
    transform: rotate(360deg);
  }
}

.inspiration__grid {
  column-count: 1;
  column-gap: 1rem;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  height: 2.2rem;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-radius: 0.6rem;
  font-size: 0.8rem;
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

.secondary-button:hover {
  border-color: rgb(232 121 78);
  color: rgb(173 74 41);
}

.secondary-button.search-submit {
  flex: 0 0 auto;
  min-width: 4.8rem;
  padding: 0 0.8rem;
  white-space: nowrap;
}

.is-spinning {
  animation: inspiration-spin 0.9s linear infinite;
}

/* 详情：左边看成片，右边读提示词 —— 与图片工作台的详情弹窗一致。 */
.detail {
  display: grid;
  height: min(38rem, calc(90vh - 11rem));
  grid-template-columns: minmax(0, 1.48fr) minmax(18rem, 0.72fr);
  align-items: stretch;
  gap: 1.25rem;
}

.detail__media {
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0.75rem;
  background: rgb(10 10 10);
}

.detail__video,
.detail__image {
  height: 100%;
  max-height: 100%;
  width: 100%;
  object-fit: contain;
  background: rgb(0 0 0);
}

.detail__placeholder {
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  width: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.detail__placeholder-image {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  object-fit: cover;
  opacity: 0.85;
}

.detail__badge {
  position: absolute;
  bottom: 0.75rem;
  left: 0.75rem;
  border-radius: 9999px;
  background: rgb(12 12 12 / 0.72);
  padding: 0.2rem 0.6rem;
  font-size: 0.7rem;
  color: rgb(245 245 245);
  backdrop-filter: blur(8px);
}

.detail__panel {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  gap: 0.55rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  padding: 1rem;
}

.detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.15rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(30 41 59);
}

.detail__copy {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.375rem;
  padding: 0.15rem 0.4rem;
  font-size: 0.74rem;
  font-weight: 400;
  color: rgb(173 74 41);
}

.detail__copy:hover {
  background: rgb(255 244 238);
}

.detail__prompt {
  overflow-wrap: anywhere;
  border-radius: 0.65rem;
  background: rgb(248 247 244);
  padding: 0.9rem 1rem;
  font-size: 0.86rem;
  line-height: 1.75;
  color: rgb(51 65 85);
  white-space: pre-wrap;
}

.detail__prompt--muted {
  color: rgb(100 116 139);
}

.detail__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem 1rem;
  margin-top: 0.4rem;
}

.detail__meta dt {
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.detail__meta dd {
  font-size: 0.8rem;
  color: rgb(30 41 59);
  overflow-wrap: anywhere;
}

.detail__hint {
  font-size: 0.8rem;
  line-height: 1.6;
  color: rgb(71 85 105);
}

.detail__requirements {
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
  list-style: disc;
}

.detail__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.detail__footer .primary-button,
.detail__footer .secondary-button {
  flex: 0 0 auto;
  padding: 0 0.9rem;
}

@media (min-width: 640px) {
  .inspiration__grid {
    column-count: 2;
  }
}

@media (min-width: 1100px) {
  .inspiration__grid {
    column-count: 3;
  }
}

@media (min-width: 1700px) {
  .inspiration__grid {
    column-count: 4;
  }
}

@media (max-width: 768px) {
  .detail {
    height: auto;
    grid-template-columns: minmax(0, 1fr);
  }

  .detail__media,
  .detail__placeholder {
    height: min(44vh, 20rem);
    min-height: 0;
  }

  .detail__panel {
    max-height: 42vh;
  }
}

:global(.dark .inspiration__header h1),
:global(.dark .detail__section-head) {
  color: rgb(242 237 229);
}

:global(.dark .online-empty) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
}

:global(.dark .filter-chip),
:global(.dark .secondary-button),
:global(.dark .toolbar-link) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(227 219 208);
}

:global(.dark .segmented) {
  background: rgb(35 33 30);
}

:global(.dark .segmented__item--active) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .detail__prompt) {
  background: rgb(44 41 37);
  color: rgb(227 219 208);
}

:global(.dark .detail__panel) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
}

:global(.dark .detail__meta dd),
:global(.dark .detail__hint),
:global(.dark .detail__requirements) {
  color: rgb(201 193 182);
}

:global(.dark .detail__copy:hover) {
  background: rgb(232 121 78 / 0.12);
}
</style>
