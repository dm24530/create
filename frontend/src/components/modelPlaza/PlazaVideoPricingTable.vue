<template>
  <div class="divide-y divide-gray-100 dark:divide-dark-700/60">
    <article
      v-for="model in models"
      :key="`${model.platform}:${model.name}`"
      class="grid grid-cols-1 items-start gap-2 px-5 py-3.5 sm:grid-cols-[34%_66%] sm:items-center sm:gap-0"
      data-video-pricing-model
    >
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="plaza-video-model-name"
          class="group/model min-w-0 max-w-full text-left"
          :title="isModelCopied(model) ? t('modelPlaza.table.modelCopied') : t('modelPlaza.table.modelCopy')"
          @click="copyModelName(model)"
        >
          <span class="block min-w-0 truncate font-medium text-gray-900 transition-colors group-hover/model:text-primary-600 group-hover/model:underline group-hover/model:decoration-dotted group-hover/model:underline-offset-2 dark:text-white dark:group-hover/model:text-primary-400">{{ model.name }}</span>
        </button>
        <button
          type="button"
          data-testid="plaza-video-model-copy"
          class="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-dark-700 dark:hover:text-primary-400"
          :title="isModelCopied(model) ? t('modelPlaza.table.modelCopied') : t('modelPlaza.table.modelCopy')"
          :aria-label="isModelCopied(model) ? t('modelPlaza.table.modelCopied') : t('modelPlaza.table.modelCopy')"
          @click="copyModelName(model)"
        >
          <Icon :name="isModelCopied(model) ? 'check' : 'clipboard'" size="xs" />
        </button>
        <span
          v-if="platform && model.platform !== platform"
          :class="[
            'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
            platformBadgeLightClass(model.platform)
          ]"
        >
          {{ platformLabel(model.platform) }}
        </span>
        <span
          class="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-dark-700/70 dark:text-dark-300"
        >
          {{ t('modelPlaza.table.perVideo') }}
        </span>
      </div>

      <div
        v-if="videoRows(model).length > 0"
        class="flex w-full max-w-full items-center gap-4 overflow-x-auto whitespace-nowrap py-0.5 sm:border-l sm:border-gray-100 sm:pl-4 dark:sm:border-dark-700/60"
        data-video-pricing-row
      >
        <span
          v-for="row in videoRows(model)"
          :key="row.key"
          class="inline-flex items-baseline gap-1.5"
        >
          <span class="text-xs font-medium text-gray-500 dark:text-dark-400">{{ row.label }}</span>
          <span class="font-mono font-semibold text-gray-900 dark:text-gray-50">
            {{ formatPerSecond(row.price) }}
            <span class="ml-1 font-sans text-xs font-normal text-gray-400 dark:text-dark-500">
              {{ t('modelPlaza.table.perUnitSecond') }}
            </span>
          </span>
        </span>
      </div>
      <p v-else class="text-xs text-gray-400 dark:text-dark-500">
        {{ t('modelPlaza.detail.noPricing') }}
      </p>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatScaled } from '@/utils/pricing'
import { platformBadgeLightClass, platformLabel } from '@/utils/platformColors'
import { useClipboard } from '@/composables/useClipboard'
import Icon from '@/components/icons/Icon.vue'
import type { PlazaModel } from '@/api/modelPlaza'

const { copyToClipboard } = useClipboard()
const copiedModelKey = ref('')
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null

function plazaVideoModelKey(model: PlazaModel): string {
  return `${model.platform}:${model.name}`
}

function isModelCopied(model: PlazaModel): boolean {
  return copiedModelKey.value === plazaVideoModelKey(model)
}

async function copyModelName(model: PlazaModel) {
  const copied = await copyToClipboard(model.name, t('modelPlaza.table.modelCopied'))
  if (!copied) return
  copiedModelKey.value = plazaVideoModelKey(model)
  if (copiedResetTimer) clearTimeout(copiedResetTimer)
  copiedResetTimer = setTimeout(() => {
    copiedModelKey.value = ''
    copiedResetTimer = null
  }, 1600)
}

onBeforeUnmount(() => {
  if (copiedResetTimer) clearTimeout(copiedResetTimer)
})

const props = defineProps<{
  models: PlazaModel[]
  platform?: string
  rateMultiplier: number
  userRateMultiplier?: number | null
  videoRateIndependent?: boolean
  videoRateMultiplier?: number | null
}>()

const { t } = useI18n()

const effectiveRate = computed(() => props.userRateMultiplier ?? props.rateMultiplier)
const fallbackRate = computed(() => Math.max(0, props.videoRateMultiplier ?? 1))

interface VideoRow {
  key: string
  label: string
  price: number
}

function videoRows(model: PlazaModel): VideoRow[] {
  const intervals = (model.pricing?.intervals ?? []).filter(
    (interval) => interval.per_request_price != null
  )
  if (intervals.length > 0) {
    return intervals.map((interval, index) => ({
      key: `${index}:${interval.tier_label ?? ''}`,
      label: (interval.tier_label || t('modelPlaza.table.standard')).toLowerCase(),
      price: interval.per_request_price!
    }))
  }
  if (model.pricing?.per_request_price != null) {
    return [{
      key: 'standard',
      label: t('modelPlaza.table.standard'),
      price: model.pricing.per_request_price
    }]
  }
  return []
}

function formatPerSecond(price: number): string {
  const rate = props.videoRateIndependent ? fallbackRate.value : effectiveRate.value
  return formatScaled(price * rate, 1, 2)
}
</script>
