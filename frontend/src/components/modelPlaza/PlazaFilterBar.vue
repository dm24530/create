<template>
  <div class="space-y-3">
    <!-- 一级:模型分组 -->
    <div class="flex items-start gap-2">
      <span class="w-10 shrink-0 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-dark-500">
        {{ t('modelPlaza.filters.groupLabel') }}
      </span>
      <div
        :class="compact ? 'plaza-filter-scroll' : 'flex flex-wrap items-center gap-2'"
        role="tablist"
        :aria-label="t('modelPlaza.filters.groupLabel')"
      >
        <button
          type="button"
          role="tab"
          class="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition"
          :class="chipClass(groupId === 'all')"
          :aria-selected="groupId === 'all'"
          @click="$emit('update:groupId', 'all')"
        >
          {{ t('modelPlaza.filters.all') }}
        </button>
        <button
          v-for="g in groups"
          :key="`group-${g.id}`"
          type="button"
          role="tab"
          class="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition"
          :class="chipClass(groupId === g.id)"
          :aria-selected="groupId === g.id"
          @click="$emit('update:groupId', g.id)"
        >
          <span class="whitespace-nowrap">{{ g.name }}</span>
          <span
            class="rounded-md px-1.5 py-0.5 font-mono text-[10px]"
            :class="groupId === g.id ? 'bg-white/15 text-white' : 'bg-black/5 text-current dark:bg-white/10'"
          >
            {{ g.modelCount }}
          </span>
        </button>
      </div>
    </div>

    <!-- 模型名搜索(纯前端过滤) -->
    <div :class="compact ? 'flex min-w-0 items-start gap-2' : 'flex flex-wrap items-start gap-2'">
      <span class="w-10 shrink-0 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-dark-500">
        {{ t('modelPlaza.filters.modelLabel') }}
      </span>
      <div :class="compact ? 'relative min-w-0 flex-1' : 'relative w-full sm:w-72'">
        <Icon
          name="search"
          size="sm"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-dark-500"
        />
        <input
          :value="search"
          type="text"
          :placeholder="t('modelPlaza.filters.searchPlaceholder')"
          class="input rounded-lg py-1.5 pl-9 pr-9"
          @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="search"
          type="button"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-dark-500 dark:hover:text-gray-300"
          @click="$emit('update:search', '')"
        >
          <Icon name="x" size="xs" class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'

withDefaults(defineProps<{
  /** 全量分组与模型数量。 */
  groups: Array<{ id: number; name: string; modelCount: number }>
  groupId: number | 'all'
  /** 模型名搜索词(纯前端过滤)。 */
  search: string
  compact?: boolean
}>(), {
  compact: false,
})

defineEmits<{
  'update:groupId': [value: number | 'all']
  'update:search': [value: string]
}>()

const { t } = useI18n()

function chipClass(active: boolean): string {
  return active
    ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-sm shadow-primary-500/30'
    : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-200 enabled:hover:bg-gray-50 enabled:hover:text-gray-900 enabled:hover:ring-gray-300 dark:bg-dark-800/60 dark:text-dark-300 dark:ring-dark-700 dark:enabled:hover:bg-dark-800 dark:enabled:hover:text-white'
}
</script>

<style scoped>
.plaza-filter-scroll {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.plaza-filter-scroll::-webkit-scrollbar {
  display: none;
}

.plaza-filter-scroll > * {
  flex-shrink: 0;
}
</style>
