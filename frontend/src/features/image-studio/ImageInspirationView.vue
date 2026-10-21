<template>
  <AppLayout>
    <div class="studio-library">
      <div class="studio-library__nav xl:hidden"><StudioNav /></div>
      <div class="studio-library__content image-inspiration">
      <header class="image-inspiration__header">
        <div>
          <h1>图片灵感库</h1>
        </div>
        <div class="image-inspiration__header-actions">
          <RouterLink class="toolbar-link" to="/image-studio">
            <Icon name="grid" size="sm" />
            <span>去图片工作台</span>
          </RouterLink>
        </div>
      </header>

      <template v-if="source === 'library'">
        <div class="inspiration-toolbar">
          <div class="inspiration-toolbar__controls">
            <label class="inline-field">
              <span>模型</span>
              <ImageStudioSelect
                v-model="libraryQuery.model"
                data-testid="image-library-model-select"
                :options="libraryModelOptions"
                @update:modelValue="reloadLibrary"
              />
            </label>
            <label class="inline-field">
              <span>分类</span>
              <ImageStudioSelect
                v-model="libraryQuery.category"
                data-testid="image-library-category-select"
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
                placeholder="关键词，如 portrait、建筑"
                data-testid="image-library-search"
                @keydown.enter.prevent="reloadLibrary"
              />
            </div>
            <button
              type="button"
              class="secondary-button search-submit"
              data-testid="image-library-search-button"
              @click="reloadLibrary"
            >
              <Icon name="search" size="sm" />
              <span>搜索</span>
            </button>
          </div>
          <div class="inspiration-toolbar__actions">
            <span class="inspiration-toolbar__hint" data-testid="image-library-summary">{{ librarySummary }}</span>
            <button
              type="button"
              class="secondary-button"
              data-testid="image-library-refresh"
              :disabled="libraryLoading"
              @click="loadLibrary({ refresh: true })"
            >
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': libraryLoading }" />
              <span>刷新</span>
            </button>
          </div>
        </div>

        <div v-if="libraryError" class="notice notice--error" data-testid="image-library-error">
          <Icon name="exclamationCircle" size="sm" />
          <span>{{ libraryError }}</span>
        </div>

        <div v-if="libraryLoading && !libraryItems.length" class="empty-state">
          <span class="spinner" aria-hidden="true"></span>
          <p>正在加载图片灵感…</p>
        </div>

        <div v-else-if="!libraryItems.length && !libraryError" class="empty-state">
          <Icon name="grid" size="lg" />
          <p>没有匹配的图片，试试换个模型、分类或关键词。</p>
        </div>

        <template v-else>
          <div class="image-inspiration__grid">
            <ImageInspirationTile
              v-for="item in libraryItems"
              :key="item.id"
              :test-id="`image-library-${item.id}`"
              :image-url="libraryCoverUrl(item)"
              :media-style="libraryFrameStyle(item)"
              :title="item.title || '图片灵感'"
              :eyebrow="item.author || item.model || item.category || '本站作品'"
              :summary="librarySummaryLine(item)"
              :spec="librarySpec(item)"
              badge="本站精选"
              :action-label="`查看「${item.title || '图片灵感'}」的大图和提示词`"
              @open="openLibraryItem(item)"
              @image-error="markLibraryCoverFailed(item.id)"
            />
          </div>

          <div v-if="libraryHasMore" class="load-more">
            <button
              type="button"
              class="secondary-button"
              data-testid="image-library-load-more"
              :disabled="libraryLoading"
              @click="loadLibrary({ append: true })"
            >
              <Icon name="arrowDown" size="sm" />
              <span>{{ libraryLoading ? '加载中' : '加载更多' }}</span>
            </button>
          </div>
        </template>
      </template>

      <template v-else>
        <div class="inspiration-toolbar">
          <div class="inspiration-toolbar__controls">
            <div class="segmented segmented--compact" role="tablist" aria-label="排序">
              <button
                v-for="option in sortOptions"
                :key="option.value"
                type="button"
                role="tab"
                class="segmented__item"
                :class="{ 'segmented__item--active': onlineQuery.sort === option.value }"
                :data-testid="`image-online-sort-${option.value}`"
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
                :data-testid="`image-online-period-${option.value}`"
                @click="setOnlineQuery({ period: option.value })"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div class="inspiration-toolbar__actions">
            <span class="inspiration-toolbar__hint">{{ onlineFetchedLabel }}</span>
            <button
              type="button"
              class="secondary-button"
              data-testid="image-online-refresh"
              :disabled="onlineLoading"
              @click="loadOnline(true)"
            >
              <Icon name="refresh" size="sm" :class="{ 'is-spinning': onlineLoading }" />
              <span>{{ onlineLoading ? '加载中' : '换一批' }}</span>
            </button>
          </div>
        </div>

        <div v-if="onlineError" class="notice notice--error" data-testid="image-online-error">
          <Icon name="exclamationCircle" size="sm" />
          <span>{{ onlineError }}</span>
        </div>

        <div v-if="onlineLoading && !onlineItems.length" class="empty-state">
          <span class="spinner" aria-hidden="true"></span>
          <p>正在拉取在线图片灵感…</p>
        </div>

        <div v-else-if="!onlineItems.length && !onlineError" class="empty-state">
          <Icon name="grid" size="lg" />
          <p>这个时间范围里暂时没有图片，换个时间范围或点「换一批」。</p>
        </div>

        <div v-else class="image-inspiration__grid">
          <ImageInspirationTile
            v-for="item in onlineItems"
            :key="item.id"
            :test-id="`image-online-${item.id}`"
            :image-url="item.posterUrl || item.mediaUrl"
            :media-style="onlineFrameStyle(item)"
            :title="promptTitle(item.prompt)"
            :eyebrow="item.author || item.model || '在线作品'"
            :summary="onlineSummary(item)"
            :spec="onlineSpec(item)"
            badge="在线灵感"
            :action-label="`查看在线图片灵感和提示词`"
            @open="openOnlineItem(item)"
          />
        </div>
      </template>
    </div>

    <BaseDialog
      :show="!!active"
      :title="active?.title || '图片灵感'"
      width="full"
      :close-on-click-outside="true"
      @close="active = null"
    >
      <div v-if="active" class="detail">
        <div class="detail__media">
          <img
            v-if="active.imageUrl"
            :src="active.imageUrl"
            alt=""
            class="detail__image"
            data-testid="image-inspiration-image"
          />
          <span v-else class="detail__placeholder" :style="active.placeholderStyle">
            <Icon name="grid" size="xl" />
          </span>
        </div>

        <section class="detail__panel">
          <div class="detail__section-head">
            <span>提示词</span>
            <button
              type="button"
              class="detail__copy"
              data-testid="image-inspiration-copy"
              @click="copyPrompt(active.prompt)"
            >
              <Icon name="copy" size="xs" />
              <span>复制</span>
            </button>
          </div>
          <p class="detail__prompt">{{ active.prompt || '这条灵感暂时没有提示词。' }}</p>

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

          <a
            v-if="active.sourceUrl"
            :href="active.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="detail__source"
          >
            <Icon name="externalLink" size="xs" />
            <span>查看来源</span>
          </a>
        </section>
      </div>

      <template #footer>
        <div class="detail__footer">
          <button
            type="button"
            class="secondary-button"
            :disabled="!active?.prompt"
            @click="active && copyPrompt(active.prompt)"
          >
            <Icon name="copy" size="sm" />
            <span>复制提示词</span>
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="!active?.prompt"
            data-testid="image-inspiration-use"
            @click="active && handoffPrompt(active.prompt)"
          >
            <Icon name="sparkles" size="sm" />
            <span>带入图片工作台</span>
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

import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import StudioNav from '@/components/layout/StudioNav.vue'
import { useClipboard } from '@/composables/useClipboard'
import ImageStudioSelect from './ImageStudioSelect.vue'
import ImageInspirationTile from './ImageInspirationTile.vue'
import { HOME_INSPIRATION_ITEMS } from './homeInspiration'
import {
  fetchInspirationLibrary,
  fetchOnlineInspirationFeed,
  type InspirationLibraryItem,
} from '../video-studio/videoArchiveApi'
import type { OnlineInspirationItem } from '../video-studio/videoInspiration'

interface MetaRow {
  label: string
  value: string
}

interface ActiveImage {
  title: string
  prompt: string
  negativePrompt: string
  imageUrl: string
  meta: MetaRow[]
  sourceUrl: string
  placeholderStyle: Record<string, string>
}

const PENDING_PROMPT_STORAGE_KEY = 'sub2api:image-studio:pending-prompt'

const router = useRouter()
const { copyToClipboard } = useClipboard()

const source = ref<'library' | 'online'>('library')
const active = ref<ActiveImage | null>(null)

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
const libraryQuery = reactive({ model: 'all', category: 'all', keyword: '' })

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
  if (libraryStale.value) parts.push('源暂时不可用，展示上次快照')
  return parts.join(' · ')
})

const onlineItems = ref<OnlineInspirationItem[]>([])
const onlineLoading = ref(false)
const onlineError = ref('')
const onlineFetchedAt = ref(0)
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
  if (!onlineFetchedAt.value) return '在线图片灵感'
  const date = new Date(onlineFetchedAt.value * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `更新于 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

let onlineAbort: AbortController | null = null

function normalizeAspectRatio(value: string): string {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/)
  return match ? `${match[1]} / ${match[2]}` : '4 / 5'
}

function fallbackTone(value: string) {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return `linear-gradient(145deg, hsl(${hash} 30% 30%), hsl(${(hash + 42) % 360} 24% 16%))`
}

function libraryFrameStyle(item: InspirationLibraryItem) {
  const ratio = item.width > 0 && item.height > 0
    ? `${item.width} / ${item.height}`
    : normalizeAspectRatio(item.aspect_ratio)
  return { aspectRatio: ratio, background: fallbackTone(item.id) }
}

function onlineFrameStyle(item: OnlineInspirationItem) {
  const ratio = item.width > 0 && item.height > 0
    ? `${item.width} / ${item.height}`
    : '4 / 5'
  return { aspectRatio: ratio, background: fallbackTone(item.id) }
}

function librarySpec(item: InspirationLibraryItem): string {
  return item.width > 0 && item.height > 0 ? `${item.width}×${item.height}` : '图片'
}

function librarySummaryLine(item: InspirationLibraryItem): string {
  return [item.category, item.model, item.likes ? `${item.likes} 赞` : ''].filter(Boolean).join(' · ') || '本站作品'
}

function onlineSpec(item: OnlineInspirationItem): string {
  return item.width > 0 && item.height > 0 ? `${item.width}×${item.height}` : '图片'
}

function onlineSummary(item: OnlineInspirationItem): string {
  return [item.model, item.likes ? `${item.likes} 赞` : ''].filter(Boolean).join(' · ') || '在线作品'
}

function promptTitle(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0].trim()
  if (!firstLine) return '在线图片灵感'
  return firstLine.length > 46 ? `${firstLine.slice(0, 46)}…` : firstLine
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

function localHomeItems(): InspirationLibraryItem[] {
  const keyword = libraryQuery.keyword.trim().toLowerCase()
  return HOME_INSPIRATION_ITEMS.filter((item) => {
    if (libraryQuery.model !== 'all' && item.model !== libraryQuery.model) return false
    if (libraryQuery.category !== 'all' && item.category !== libraryQuery.category) return false
    if (!keyword) return true
    return `${item.title} ${item.prompt}`.toLowerCase().includes(keyword)
  })
}

async function loadLibrary(options: { append?: boolean; refresh?: boolean } = {}) {
  const append = options.append === true
  const page = append ? libraryPageNumber.value + 1 : 1
  libraryLoading.value = true
  libraryError.value = ''
  try {
    const result = await fetchInspirationLibrary({
      type: 'image',
      model: libraryQuery.model,
      category: libraryQuery.category,
      keyword: libraryQuery.keyword,
      page,
      pageSize: 60,
      refresh: options.refresh === true,
    })
    const localItems = page === 1 ? localHomeItems() : []
    libraryItems.value = append
      ? [...libraryItems.value, ...localItems, ...result.items]
      : [...localItems, ...result.items]
    libraryPageNumber.value = page
    libraryTotal.value = result.total + (page === 1 ? localItems.length : 0)
    libraryHasMore.value = result.has_more
    libraryFetchedAt.value = result.fetched_at
    libraryStale.value = result.stale
    libraryModels.value = Array.from(new Set([...result.models, ...HOME_INSPIRATION_ITEMS.map((item) => item.model)]))
    libraryCategories.value = Array.from(new Set([...result.categories, ...HOME_INSPIRATION_ITEMS.map((item) => item.category)]))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    libraryItems.value = localHomeItems()
    libraryModels.value = Array.from(new Set(HOME_INSPIRATION_ITEMS.map((item) => item.model)))
    libraryCategories.value = Array.from(new Set(HOME_INSPIRATION_ITEMS.map((item) => item.category)))
    libraryTotal.value = libraryItems.value.length
    libraryError.value = message
      ? `在线作品库暂时不可用，已展示本站家居灵感：${message}`
      : '在线作品库暂时不可用，已展示本站家居灵感。'
  } finally {
    libraryLoading.value = false
  }
}

function setOnlineQuery(patch: Partial<typeof onlineQuery>) {
  Object.assign(onlineQuery, patch)
  void loadOnline()
}

async function loadOnline(refresh = false) {
  onlineAbort?.abort()
  const controller = new AbortController()
  onlineAbort = controller
  onlineLoading.value = true
  onlineError.value = ''
  try {
    const feed = await fetchOnlineInspirationFeed({
      mediaType: 'image',
      sort: onlineQuery.sort,
      period: onlineQuery.period,
      limit: 48,
      refresh,
    })
    if (controller.signal.aborted) return
    onlineFetchedAt.value = feed.fetched_at
    onlineItems.value = feed.items
      .filter((entry) => entry.media_type === 'image')
      .map((entry) => ({
        id: String(entry.id),
        mediaType: 'image' as const,
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
      onlineError.value = '这个时间范围里没有拉到带提示词的图片，换个时间范围或点「换一批」。'
    }
  } catch (error) {
    if (controller.signal.aborted) return
    console.error('Failed to load online image inspiration:', error)
    onlineError.value = '在线图片灵感暂时不可用，请稍后重试。'
  } finally {
    if (!controller.signal.aborted) onlineLoading.value = false
  }
}

function openLibraryItem(item: InspirationLibraryItem) {
  active.value = {
    title: item.title || '图片灵感',
    prompt: item.prompt,
    negativePrompt: '',
    imageUrl: libraryCoverUrl(item),
    meta: [
      { label: '模型', value: item.model || '未知' },
      { label: '分类', value: item.category || '—' },
      { label: '尺寸', value: librarySpec(item) },
      ...(item.author ? [{ label: '作者', value: item.author }] : []),
      ...(item.likes ? [{ label: '喜欢', value: String(item.likes) }] : []),
      ...(item.views ? [{ label: '浏览', value: String(item.views) }] : []),
    ],
    sourceUrl: item.source_url,
    placeholderStyle: { background: fallbackTone(item.id) },
  }
}

function openOnlineItem(item: OnlineInspirationItem) {
  active.value = {
    title: '在线图片灵感',
    prompt: item.prompt,
    negativePrompt: item.negativePrompt,
    imageUrl: item.posterUrl || item.mediaUrl,
    meta: [
      { label: '模型', value: item.model || '未知' },
      { label: '尺寸', value: onlineSpec(item) },
      ...(item.author ? [{ label: '作者', value: item.author }] : []),
      ...(item.likes ? [{ label: '喜欢', value: String(item.likes) }] : []),
    ],
    sourceUrl: '',
    placeholderStyle: { background: fallbackTone(item.id) },
  }
}

async function copyPrompt(prompt: string) {
  if (!prompt.trim()) return
  await copyToClipboard(prompt, '提示词已复制')
}

function handoffPrompt(prompt: string) {
  const value = prompt.trim()
  if (!value) return
  try {
    sessionStorage.setItem(PENDING_PROMPT_STORAGE_KEY, value)
  } catch {
    // 浏览器存储不可用时仍然回到工作台。
  }
  active.value = null
  void router.push({ path: '/image-studio' })
}

onBeforeUnmount(() => {
  onlineAbort?.abort()
})

onMounted(() => {
  void loadLibrary()
})
</script>

<style scoped>
.image-inspiration {
  display: flex;
  width: 100%;
  max-width: 120rem;
  margin: 0 auto;
  flex-direction: column;
  gap: 1rem;
}

.image-inspiration__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.image-inspiration__header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: rgb(17 24 39);
}

.image-inspiration__header p {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: rgb(107 114 128);
}

.image-inspiration__header-actions {
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

.inspiration-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.inspiration-toolbar__controls,
.inspiration-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.inspiration-toolbar__hint {
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
  min-width: 12rem;
  border: 0;
  background: transparent;
  padding: 0;
}

.segmented--compact .segmented__item {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.5rem;
  padding: 0.55rem 0.75rem;
  font-size: 0.82rem;
}

.notice--error {
  border: 1px solid rgb(254 202 202);
  background: rgb(254 242 242);
  color: rgb(185 28 28);
}

.empty-state {
  display: flex;
  min-height: 13rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
  padding: 1.25rem;
  text-align: center;
  font-size: 0.85rem;
  color: rgb(107 114 128);
}

.spinner {
  height: 1.6rem;
  width: 1.6rem;
  border-radius: 9999px;
  border: 2px solid rgb(148 163 184 / 0.35);
  border-top-color: rgb(232 121 78);
  animation: image-inspiration-spin 0.9s linear infinite;
}

.is-spinning {
  animation: image-inspiration-spin 0.9s linear infinite;
}

@keyframes image-inspiration-spin {
  to {
    transform: rotate(360deg);
  }
}

.image-inspiration__grid {
  column-count: 1;
  column-gap: 1rem;
}

.load-more {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 0.25rem;
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

.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
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

.load-more .secondary-button {
  flex: 0 0 auto;
  padding: 0 1rem;
}

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

.detail__image {
  height: 100%;
  max-height: 100%;
  width: 100%;
  object-fit: contain;
  background: rgb(0 0 0);
}

.detail__placeholder {
  display: flex;
  height: 100%;
  width: 100%;
  align-items: center;
  justify-content: center;
  color: rgb(226 232 240 / 0.72);
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
  overflow-wrap: anywhere;
  font-size: 0.8rem;
  color: rgb(30 41 59);
}

.detail__source {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.3rem;
  margin-top: auto;
  padding-top: 0.5rem;
  font-size: 0.78rem;
  color: rgb(173 74 41);
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
  .image-inspiration__grid {
    column-count: 2;
  }
}

@media (min-width: 1100px) {
  .image-inspiration__grid {
    column-count: 3;
  }
}

@media (min-width: 1700px) {
  .image-inspiration__grid {
    column-count: 4;
  }
}

@media (max-width: 768px) {
  .detail {
    height: auto;
    grid-template-columns: minmax(0, 1fr);
  }

  .detail__media {
    height: min(44vh, 20rem);
  }

  .detail__panel {
    max-height: 42vh;
  }
}

:global(.dark .image-inspiration__header h1),
:global(.dark .detail__section-head) {
  color: rgb(242 237 229);
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

:global(.dark .segmented) {
  background: rgb(35 33 30);
}

:global(.dark .segmented__item--active) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .empty-state),
:global(.dark .secondary-button),
:global(.dark .toolbar-link) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(227 219 208);
}

:global(.dark .detail__panel) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
}

:global(.dark .detail__prompt) {
  background: rgb(44 41 37);
  color: rgb(227 219 208);
}

:global(.dark .detail__meta dd) {
  color: rgb(201 193 182);
}

:global(.dark .detail__copy:hover) {
  background: rgb(232 121 78 / 0.12);
}
</style>
