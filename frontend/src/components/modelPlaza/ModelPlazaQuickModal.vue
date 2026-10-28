<template>
  <BaseDialog
    :show="show"
    title="模型广场"
    width="extra-wide"
    body-class="model-plaza-modal-body"
    :close-on-click-outside="true"
    @close="emit('close')"
  >
    <ModelPlazaContent
      :response="data"
      :loading="loading"
      :error="loadFailed"
      embedded
      compact-filters
    />
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import BaseDialog from '@/components/common/BaseDialog.vue'
import ModelPlazaContent from './ModelPlazaContent.vue'
import {
  getModelPlaza,
  type ModelPlazaGroup,
  type ModelPlazaResponse,
} from '@/api/modelPlaza'
import { userChannelsAPI, type UserAvailableChannel } from '@/api/channels'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const data = ref<ModelPlazaResponse | null>(null)
const loading = ref(false)
const loadFailed = ref(false)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    void loadPlaza()
  },
  { immediate: true },
)

async function loadPlaza() {
  loading.value = true
  loadFailed.value = false
  try {
    data.value = await getModelPlaza()
  } catch {
    try {
      data.value = buildFallbackPlaza(await userChannelsAPI.getAvailableModels())
    } catch {
      loadFailed.value = true
    }
  } finally {
    loading.value = false
  }
}

function buildFallbackPlaza(channels: UserAvailableChannel[]): ModelPlazaResponse {
  const groups = new Map<number, ModelPlazaGroup>()
  for (const channel of channels) {
    for (const section of channel.platforms) {
      for (const group of section.groups) {
        let target = groups.get(group.id)
        if (!target) {
          target = {
            id: group.id,
            name: group.name,
            description: '',
            platform: group.platform,
            subscription_type: group.subscription_type,
            rate_multiplier: group.rate_multiplier,
            peak_rate_enabled: group.peak_rate_enabled,
            peak_start: group.peak_start,
            peak_end: group.peak_end,
            peak_rate_multiplier: group.peak_rate_multiplier,
            is_exclusive: group.is_exclusive,
            image_rate_independent: false,
            image_rate_multiplier: 1,
            video_rate_independent: false,
            video_rate_multiplier: 1,
            long_context_pricing_enabled: false,
            models: [],
          }
          groups.set(group.id, target)
        }
        for (const model of section.supported_models) {
          if (target.models.some((item) => item.name === model.name && item.platform === model.platform)) continue
          target.models.push({
            name: model.name,
            platform: model.platform,
            pricing: model.pricing,
            official_pricing: null,
          })
        }
      }
    }
  }
  return {
    description: '',
    groups: [...groups.values()].filter((group) => group.models.length > 0),
  }
}
</script>

<style scoped>
:global(.model-plaza-modal-body) {
  padding-top: 0.75rem;
}
</style>
