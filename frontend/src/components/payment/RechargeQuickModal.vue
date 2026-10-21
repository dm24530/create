<template>
  <BaseDialog
    :show="show"
    title="充值"
    width="extra-wide"
    headerless
    body-class="max-h-[78vh] overflow-y-auto"
    :close-on-click-outside="true"
    @close="emit('close')"
  >
    <div class="mb-4 flex gap-2 border-b border-gray-200 pr-10 dark:border-dark-700">
      <button
        type="button"
        class="tab"
        :class="{ 'tab-active': activeTab === 'recharge' }"
        @click="activeTab = 'recharge'"
      >
        充值
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab-active': activeTab === 'redeem' }"
        @click="activeTab = 'redeem'"
      >
        兑换码
      </button>
    </div>

    <PaymentView v-if="activeTab === 'recharge'" embedded @open-redeem="activeTab = 'redeem'" />
    <RedeemView v-else embedded />
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import BaseDialog from '@/components/common/BaseDialog.vue'
import PaymentView from '@/views/user/PaymentView.vue'
import RedeemView from '@/views/user/RedeemView.vue'

const props = withDefaults(defineProps<{
  show: boolean
  initialTab?: 'recharge' | 'redeem'
}>(), {
  initialTab: 'recharge',
})
const emit = defineEmits<{ (event: 'close'): void }>()

const activeTab = ref<'recharge' | 'redeem'>(props.initialTab)

watch(
  [() => props.show, () => props.initialTab],
  ([show, tab]) => {
    if (show) activeTab.value = tab
  },
  { immediate: true },
)
</script>
