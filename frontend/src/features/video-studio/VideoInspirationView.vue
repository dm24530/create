<template>
  <AppLayout>
    <div class="inspiration">
      <header class="inspiration__header">
        <div>
          <h1>视频灵感库</h1>
          <p>左边看作片效果，右边是完整提示词，一键复制或直接带入工作台。</p>
        </div>
        <div class="inspiration__header-actions">
          <div class="segmented" role="tablist" aria-label="灵感来源">
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
            <button
              type="button"
              role="tab"
              class="segmented__item"
              :class="{ 'segmented__item--active': source === 'online' }"
              :aria-selected="source === 'online'"
              data-testid="inspiration-source-online"
              @click="switchSource('online')"
            >
              在线灵感
            </button>
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
          <article
            v-for="template in filteredTemplates"
            :key="template.slug"
            class="template-card"
            :data-testid="`template-${template.slug}`"
          >
            <button type="button" class="template-card__poster" @click="openTemplate(template)">
              <span class="template-card__frame" :style="posterStyle(template)">
                <img
                  v-if="templatePoster(template)"
                  :src="templatePoster(template)"
                  alt=""
                  loading="lazy"
                  class="template-card__poster-image"
                  @error="markPosterFailed(template.slug)"
                />
                <span class="template-card__play">
                  <Icon name="play" size="md" />
                </span>
              </span>
              <span class="template-card__spec">{{ template.durationSeconds }}s · {{ template.aspectRatio }}</span>
            </button>
            <div class="template-card__body">
              <p class="template-card__category">{{ template.category }}</p>
              <h2 class="template-card__title">{{ template.title }}</h2>
              <p class="template-card__summary">{{ template.summary }}</p>
              <p class="template-card__prompt">{{ template.prompt }}</p>
            </div>
            <div class="template-card__actions">
              <button type="button" class="primary-button" @click="useTemplate(template)">
                <Icon name="sparkles" size="sm" />
                <span>带入工作台</span>
              </button>
              <button type="button" class="secondary-button" @click="copyPrompt(template.prompt)">
                <Icon name="copy" size="sm" />
                <span>复制提示词</span>
              </button>
            </div>
          </article>
        </div>
      </template>

      <template v-else-if="source === 'online'">
        <div class="online-bar">
          <div class="online-bar__controls">
            <div class="segmented segmented--compact" role="tablist" aria-label="素材类型">
              <button
                v-for="option in mediaTypeOptions"
                :key="option.value"
                type="button"
                role="tab"
                class="segmented__item"
                :class="{ 'segmented__item--active': onlineQuery.mediaType === option.value }"
                :data-testid="`online-media-${option.value}`"
                @click="setOnlineQuery({ mediaType: option.value })"
              >
                {{ option.label }}
              </button>
            </div>
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
          <article
            v-for="item in onlineItems"
            :key="item.id"
            class="template-card"
            :data-testid="`online-${item.id}`"
          >
            <button type="button" class="template-card__poster" @click="openOnline(item)">
              <span class="template-card__frame" :style="onlineFrameStyle(item)">
                <img
                  v-if="item.posterUrl"
                  :src="item.posterUrl"
                  alt=""
                  loading="lazy"
                  class="template-card__poster-image"
                />
                <span class="template-card__play">
                  <Icon :name="item.mediaType === 'video' ? 'play' : 'grid'" size="md" />
                </span>
              </span>
              <span class="template-card__spec">
                {{ item.mediaType === 'video' ? '视频' : '图片' }} · {{ item.width }}×{{ item.height }}
              </span>
            </button>
            <div class="template-card__body">
              <p class="template-card__category">{{ item.model || '未知模型' }}</p>
              <p class="template-card__prompt template-card__prompt--clamp">{{ item.prompt }}</p>
              <p class="template-card__summary">@{{ item.author || '匿名' }} · {{ item.likes }} 赞</p>
            </div>
            <div class="template-card__actions">
              <button type="button" class="primary-button" @click="useOnline(item)">
                <Icon name="sparkles" size="sm" />
                <span>带入工作台</span>
              </button>
              <button type="button" class="secondary-button" @click="copyPrompt(item.prompt)">
                <Icon name="copy" size="sm" />
                <span>复制提示词</span>
              </button>
            </div>
          </article>
        </div>
      </template>

      <template v-else>
        <!-- 作品库：自家灵感站的数据（视频提示词 / 图片灵感），服务端筛选分页 -->
        <div class="online-bar">
          <div class="online-bar__controls">
            <div class="segmented segmented--compact" role="tablist" aria-label="作品类型">
              <button
                v-for="option in libraryTypeOptions"
                :key="option.value"
                type="button"
                role="tab"
                class="segmented__item"
                :class="{ 'segmented__item--active': libraryQuery.type === option.value }"
                :data-testid="`library-type-${option.value}`"
                @click="setLibraryQuery({ type: option.value })"
              >
                {{ option.label }}
              </button>
            </div>
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
            <button type="button" class="secondary-button" data-testid="library-search-button" @click="reloadLibrary">
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
            <article
              v-for="item in libraryItems"
              :key="item.id"
              class="template-card"
              :data-testid="`library-${item.id}`"
            >
              <button type="button" class="template-card__poster" @click="openLibraryItem(item)">
                <span class="template-card__frame" :style="libraryFrameStyle(item)">
                  <img
                    v-if="item.cover_url"
                    :src="item.cover_url"
                    alt=""
                    loading="lazy"
                    class="template-card__poster-image"
                    @error="markLibraryCoverFailed(item.id)"
                  />
                  <span class="template-card__play">
                    <Icon :name="item.type === 'video' ? 'play' : 'grid'" size="md" />
                  </span>
                </span>
                <span class="template-card__spec">{{ librarySpec(item) }}</span>
              </button>
              <div class="template-card__body">
                <p class="template-card__category">{{ item.model || item.category || '作品' }}</p>
                <h2 class="template-card__title">{{ item.title }}</h2>
                <p class="template-card__prompt">{{ item.prompt }}</p>
                <p v-if="item.author" class="template-card__summary">
                  @{{ item.author_handle || item.author }} · {{ item.likes }} 赞
                </p>
              </div>
              <div class="template-card__actions">
                <button type="button" class="primary-button" @click="useLibraryItem(item)">
                  <Icon name="sparkles" size="sm" />
                  <span>带入工作台</span>
                </button>
                <button type="button" class="secondary-button" @click="copyPrompt(item.prompt)">
                  <Icon name="copy" size="sm" />
                  <span>复制提示词</span>
                </button>
              </div>
            </article>
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
      width="extra-wide"
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
            <span class="template-card__play">
              <Icon name="play" size="md" />
            </span>
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
          <a
            v-if="active?.sourceUrl"
            class="detail__source"
            :href="active.sourceUrl"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="link" size="xs" />
            <span>查看原作品</span>
          </a>
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
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppLayout from '@/components/layout/AppLayout.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { useClipboard } from '@/composables/useClipboard'
import ImageStudioSelect from '../image-studio/ImageStudioSelect.vue'

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
  sourceUrl: string
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

const source = ref<'curated' | 'online' | 'library'>('curated')
const activeCategory = ref('')
const active = ref<ActiveInspiration | null>(null)
// 分镜图取不到时记下来，退回色板底图，避免一直重试破图。
const failedPosters = ref<Record<string, boolean>>({})

const onlineItems = ref<OnlineInspirationItem[]>([])
const onlineLoading = ref(false)
const onlineError = ref('')
const onlineFetchedAt = ref(0)
let onlineAbort: AbortController | null = null

// 公开社区每天都有新作品：默认「视频 + 最新 + 本周」，按需切到图片或当天。
const onlineQuery = reactive<{ mediaType: 'video' | 'image'; sort: 'newest' | 'reactions'; period: 'day' | 'week' | 'month' | 'all' }>({
  mediaType: 'video',
  sort: 'newest',
  period: 'week',
})
const mediaTypeOptions = [
  { value: 'video' as const, label: '视频' },
  { value: 'image' as const, label: '图片' },
]
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
  if (!onlineFetchedAt.value) return '来自公开创作社区，服务端拉取并经本站代理'
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
const libraryQuery = reactive<{ type: 'video' | 'image'; model: string; category: string; keyword: string }>({
  type: 'video',
  model: 'all',
  category: 'all',
  keyword: '',
})
const libraryTypeOptions = [
  { value: 'video' as const, label: '视频提示词' },
  { value: 'image' as const, label: '图片灵感' },
]
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
    mediaType: 'none',
    mediaUrl: '',
    posterUrl: '',
    sourceUrl: '',
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
    sourceUrl: item.sourceUrl,
    meta: [
      { label: '模型', value: item.model || '未知' },
      { label: '尺寸', value: `${item.width}×${item.height}` },
      { label: '作者', value: item.author || '匿名' },
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
  try {
    const feed = await fetchOnlineInspirationFeed({
      mediaType: onlineQuery.mediaType,
      sort: onlineQuery.sort,
      period: onlineQuery.period,
      limit: 24,
      refresh,
    })
    if (controller.signal.aborted) return
    onlineFetchedAt.value = feed.fetched_at
    onlineItems.value = feed.items.map((entry) => ({
      id: String(entry.id),
      mediaType: entry.media_type === 'image' ? 'image' : 'video',
      mediaUrl: String(entry.media_url ?? ''),
      posterUrl: String(entry.poster_url ?? ''),
      prompt: String(entry.prompt ?? ''),
      negativePrompt: String(entry.negative_prompt ?? ''),
      model: String(entry.model ?? ''),
      author: String(entry.author ?? ''),
      width: Number(entry.width ?? 0) || 0,
      height: Number(entry.height ?? 0) || 0,
      likes: Number(entry.likes ?? 0) || 0,
      sourceUrl: String(entry.source_url ?? ''),
    }))
    if (!onlineItems.value.length) {
      onlineError.value = '这个时间范围里没有拉到带提示词的作品，换个时间范围或点「换一批」。'
    }
  } catch (error) {
    if (controller.signal.aborted) return
    // 拉取在服务端进行：失败通常是服务器出网不通（可配 update.proxy_url 代理）。
    const message = error instanceof Error ? error.message : ''
    onlineError.value = message
      ? `拉取在线灵感失败：${message}。如果服务器在国内，请给 update.proxy_url 配一个代理后重试。`
      : '拉取在线灵感失败：请检查服务器的出网与代理配置。'
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
  const ratio = item.width > 0 && item.height > 0 ? `${item.width} / ${item.height}` : '16 / 9'
  return { aspectRatio: ratio, background: 'rgb(15 23 42)' }
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

function setLibraryQuery(patch: Partial<typeof libraryQuery>) {
  Object.assign(libraryQuery, patch)
  // 换类型时模型/分类的候选会变，回到"全部"再取。
  if (patch.type) {
    libraryQuery.model = 'all'
    libraryQuery.category = 'all'
  }
  void loadLibrary()
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
      type: libraryQuery.type,
      model: libraryQuery.model,
      category: libraryQuery.category,
      keyword: libraryQuery.keyword,
      page,
      pageSize: 24,
      refresh: options.refresh === true,
    })
    libraryItems.value = append ? [...libraryItems.value, ...result.items] : result.items
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
    sourceUrl: item.source_url || '',
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
      ...(item.author ? [{ label: '作者', value: item.author_handle || item.author }] : []),
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

function useLibraryItem(item: InspirationLibraryItem) {
  active.value = null
  handoffPrompt(item.prompt)
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

function useOnline(item: OnlineInspirationItem) {
  active.value = null
  handoffPrompt(item.prompt)
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
  color: rgb(15 118 110);
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
  border-color: rgb(45 212 191);
  color: rgb(15 118 110);
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
  border-color: rgb(45 212 191);
  color: rgb(15 118 110);
}

.filter-chip--active {
  border-color: rgb(13 148 136);
  background: rgb(240 253 250);
  color: rgb(15 118 110);
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
  height: 2.2rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.6rem;
  background: rgb(255 255 255);
  padding: 0 0.55rem;
  font-size: 0.75rem;
  color: rgb(107 114 128);
}

.inline-field .text-input {
  height: 1.9rem;
  min-width: 11rem;
  border: 0;
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
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
  color: rgb(148 163 184);
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
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1rem;
}

.template-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
}

.template-card__poster {
  position: relative;
  display: flex;
  height: 10rem;
  width: 100%;
  align-items: center;
  justify-content: center;
  background: rgb(15 23 42);
  padding: 1rem;
}

.template-card__frame {
  position: relative;
  display: flex;
  height: 100%;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0.5rem;
}

.template-card__poster-image {
  height: 100%;
  width: 100%;
  object-fit: cover;
}

.template-card__play {
  position: absolute;
  display: inline-flex;
  height: 2.5rem;
  width: 2.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: rgb(255 255 255 / 0.92);
  color: rgb(15 118 110);
}

.template-card__spec {
  position: absolute;
  right: 1.4rem;
  bottom: 1.4rem;
  border-radius: 9999px;
  background: rgb(15 23 42 / 0.72);
  padding: 0.15rem 0.55rem;
  font-size: 0.7rem;
  color: rgb(241 245 249);
}

.template-card__body {
  flex: 1;
  padding: 0.85rem 0.95rem 0.5rem;
}

.template-card__category {
  font-size: 0.72rem;
  color: rgb(13 148 136);
}

.template-card__title {
  margin-top: 0.15rem;
  font-size: 1rem;
  font-weight: 600;
  color: rgb(17 24 39);
}

.template-card__summary {
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: rgb(107 114 128);
}

.template-card__prompt {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  margin-top: 0.5rem;
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgb(100 116 139);
}

.template-card__prompt--clamp {
  margin-top: 0.2rem;
  color: rgb(71 85 105);
}

.template-card__actions {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 0.95rem 0.95rem;
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

.secondary-button:hover {
  border-color: rgb(45 212 191);
  color: rgb(15 118 110);
}

.is-spinning {
  animation: inspiration-spin 0.9s linear infinite;
}

/* 详情：左边看成片，右边读提示词 —— 与图片工作台的详情弹窗一致。 */
.detail {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 1rem;
}

.detail__media {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0.5rem;
  background: rgb(15 23 42);
}

.detail__video,
.detail__image {
  max-height: 70vh;
  width: 100%;
  object-fit: contain;
  background: rgb(0 0 0);
}

.detail__placeholder {
  position: relative;
  display: flex;
  height: 18rem;
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

.detail__panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.4rem;
}

.detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.4rem;
  font-size: 0.8rem;
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
  color: rgb(13 148 136);
}

.detail__copy:hover {
  background: rgb(240 253 250);
}

.detail__prompt {
  overflow-wrap: anywhere;
  border-radius: 0.5rem;
  background: rgb(248 250 252);
  padding: 0.7rem 0.85rem;
  font-size: 0.82rem;
  line-height: 1.65;
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

.detail__source {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-right: auto;
  font-size: 0.78rem;
  color: rgb(107 114 128);
  text-decoration: none;
}

.detail__source:hover {
  color: rgb(15 118 110);
}

.detail__footer .primary-button,
.detail__footer .secondary-button {
  flex: 0 0 auto;
  padding: 0 0.9rem;
}

@media (min-width: 640px) {
  .inspiration__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .inspiration__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .detail {
    grid-template-columns: minmax(0, 1fr);
  }
}

:global(.dark .inspiration__header h1),
:global(.dark .template-card__title),
:global(.dark .detail__section-head) {
  color: rgb(255 255 255);
}

:global(.dark .template-card),
:global(.dark .online-empty) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
}

:global(.dark .filter-chip),
:global(.dark .secondary-button),
:global(.dark .toolbar-link) {
  border-color: rgb(51 65 85);
  background: rgb(30 41 59);
  color: rgb(226 232 240);
}

:global(.dark .segmented) {
  background: rgb(30 41 59);
}

:global(.dark .segmented__item--active) {
  background: rgb(15 23 42);
  color: rgb(94 234 212);
}

:global(.dark .detail__prompt) {
  background: rgb(30 41 59);
  color: rgb(226 232 240);
}

:global(.dark .detail__meta dd),
:global(.dark .detail__hint),
:global(.dark .detail__requirements) {
  color: rgb(203 213 225);
}
</style>
