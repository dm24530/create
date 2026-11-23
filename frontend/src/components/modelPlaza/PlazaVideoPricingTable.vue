<template>
  <div class="grid gap-3 p-4 xl:grid-cols-2">
    <article
      v-for="model in models"
      :key="`${model.platform}:${model.name}`"
      class="rounded-xl border border-gray-200/80 p-4 dark:border-dark-700/80"
      data-video-pricing-model
    >
      <div>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                data-testid="plaza-video-model-name"
                class="min-w-0 text-left"
                :title="isModelCopied(model) ? t('modelPlaza.table.modelCopied') : t('modelPlaza.table.modelCopy')"
                @click="copyModelName(model)"
              >
                <span class="block min-w-0 truncate font-medium text-gray-900 dark:text-white">{{ model.name }}</span>
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
            </div>

            <span
              v-if="platform && model.platform !== platform"
              :class="[
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                platformBadgeLightClass(model.platform)
              ]"
            >
              {{ platformLabel(model.platform) }}
            </span>
            <span class="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-dark-700/70 dark:text-dark-300">
              {{ billingLabel(model) }}
            </span>
          </div>
          <span class="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300">
            {{ t('modelPlaza.videoPricing.durationLabel') }} {{ durationLabel(model) }}
          </span>
        </div>
      </div>
      <p
        v-if="modelDescription(model.description)"
        class="mt-2 whitespace-pre-line break-words text-xs leading-5 text-gray-500 dark:text-dark-300"
      >
        {{ modelDescription(model.description) }}
      </p>
      <div v-if="videoRows(model).length" class="mt-2 rounded-lg border border-gray-100 dark:border-dark-700/60">
        <table class="w-full table-fixed text-left text-xs">
          <thead class="bg-gray-50/80 text-[11px] text-gray-400 dark:bg-dark-900/40">
            <tr>
              <th class="w-[18%] px-2.5 py-1.5 font-medium">{{ t('modelPlaza.videoPricing.resolution') }}</th>
              <th class="w-[17%] px-2.5 py-1.5 font-medium">{{ t('modelPlaza.videoPricing.billing') }}</th>
              <th class="w-[18%] px-2.5 py-1.5 font-medium">{{ t('modelPlaza.videoPricing.duration') }}</th>
              <th class="px-2.5 py-1.5 text-right font-medium">{{ t('modelPlaza.videoPricing.price') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-dark-700/60">
            <tr v-for="row in videoRows(model)" :key="row.key" data-video-pricing-row>
              <td class="px-2.5 py-2 font-medium text-gray-700 dark:text-dark-100">{{ row.resolution }}</td>
              <td class="px-2.5 py-2 text-gray-500 dark:text-dark-400">{{ billingLabel(model) }}</td>
              <td class="break-words px-2.5 py-2 text-gray-500 dark:text-dark-400">{{ row.duration }}</td>
              <td class="px-2.5 py-2 text-right">
                <div class="font-mono text-sm font-semibold text-gray-900 dark:text-white">
                  {{ formatPrice(row.price) }}
                  <span class="ml-1 font-sans text-[11px] font-normal text-gray-400">{{ unitLabel(model) }}</span>
                </div>
                <div v-if="billingUnit(model) === 'second'" class="mt-1 whitespace-normal break-words text-[10px] leading-4 text-gray-400">
                  {{ durationEstimates(model, row.price) }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400 dark:border-dark-700">{{ t('modelPlaza.detail.noPricing') }}</p>
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
import type { UserPricingInterval } from '@/api/channels'
import { videoBillingUnit, videoDurationLabel, videoPreviewDurations } from './videoModelMeta'

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
  resolution: string
  duration: string
  price: number
}

interface VideoTierParts {
  resolution: string
  duration: string
}

/** 视频按次档位同时包含分辨率和时长，例如 480p-10s / 720p-15s。 */
function splitVideoTierLabel(label: string, interval: UserPricingInterval): VideoTierParts {
  const raw = (label || '').trim()
  const match = raw.match(/^(.*?)(?:\s*[-_/]?\s*)(\d+)(?:\s*[-_/]\s*(\d+))?s$/i)
  if (match) {
    const start = Number(match[2])
    const end = match[3] ? Number(match[3]) : start
    return {
      resolution: (match[1] || t('modelPlaza.table.standard')).trim().toLowerCase(),
      duration: start === end ? `${start}s` : `${start}–${end}s`,
    }
  }
  const min = Number(interval?.min_tokens ?? 0)
  const max = interval?.max_tokens == null ? null : Number(interval.max_tokens)
  return {
    resolution: (raw || t('modelPlaza.table.standard')).toLowerCase(),
    duration: max != null && max > 0 ? (min > 0 && min !== max ? `${min}–${max}s` : `${max}s`) : t('modelPlaza.table.standard'),
  }
}

function videoRows(model: PlazaModel): VideoRow[] {
  const intervals = (model.pricing?.intervals ?? []).filter(
    (interval) => interval.per_request_price != null,
  )
  if (intervals.length > 0) {
    return intervals.map((interval, index) => {
      const tier = splitVideoTierLabel(interval.tier_label ?? '', interval)
      return {
        key: `${index}:${interval.tier_label ?? ''}`,
        resolution: tier.resolution,
        duration: billingUnit(model) === 'second' ? durationLabel(model) : tier.duration,
        price: interval.per_request_price!,
      }
    })
  }
  if (model.pricing?.per_request_price != null) {
    return [{
      key: 'standard',
      resolution: t('modelPlaza.table.standard'),
      duration: durationLabel(model),
      price: model.pricing.per_request_price,
    }]
  }
  return []
}

function modelDescription(description?: string): string {
  return (description || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function billingUnit(model: PlazaModel) {
  return videoBillingUnit(model)
}

function billingLabel(model: PlazaModel) {
  return billingUnit(model) === 'second'
    ? t('modelPlaza.videoPricing.perSecond')
    : t('modelPlaza.videoPricing.perRequest')
}

function unitLabel(model: PlazaModel) {
  return billingUnit(model) === 'second'
    ? t('modelPlaza.table.perUnitSecond')
    : t('modelPlaza.table.perUnitRequest')
}

function durationLabel(model: PlazaModel) {
  return videoDurationLabel(model)
}
function priceWithRate(price: number) {
  const rate = props.videoRateIndependent ? fallbackRate.value : effectiveRate.value
  return price * rate
}

function formatPrice(price: number) {
  return formatScaled(priceWithRate(price), 1, 2)
}

function durationEstimates(model: PlazaModel, secondPrice: number) {
  return videoPreviewDurations(model)
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0)
    .map((seconds) => `${seconds}s ≈ ${formatScaled(priceWithRate(secondPrice) * seconds, 1, 2)}`)
    .join(' · ')
}
</script>
