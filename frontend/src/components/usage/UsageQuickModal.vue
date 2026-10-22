<template>
  <BaseDialog
    :show="show"
    title="使用记录"
    width="extra-wide"
    body-class="usage-quick-modal-body"
    :close-on-click-outside="true"
    @close="emit('close')"
  >
    <div class="usage-quick-modal">
      <UsageStatsCards
        class="usage-quick-modal__stats"
        :stats="stats"
        :show-tokens="false"
        :show-cost="true"
        :show-account-cost="false"
        :show-cost-breakdown="false"
        :strike-standard-cost="true"
      />

      <div class="usage-quick-modal__filters flex flex-nowrap items-end gap-3 pb-1">
        <label class="w-44 shrink-0 space-y-1">
          <span class="input-label">API 密钥</span>
          <Select v-model="filterApiKeyId" :options="apiKeyOptions" @change="applyFilters" />
        </label>
        <label class="min-w-0 flex-1 space-y-1">
          <span class="input-label">模型</span>
          <input
            v-model="filterModel"
            type="search"
            class="input w-full"
            placeholder="输入模型名称后回车"
            @keydown.enter.prevent="applyFilters"
          />
        </label>
        <div class="w-[27rem] shrink-0 space-y-1">
          <span class="input-label">时间范围</span>
          <div class="flex min-w-0 items-center gap-2">
            <input
              v-model="filterStartDate"
              type="date"
              class="input usage-quick-modal__date min-w-0 flex-1"
              :max="filterEndDate || undefined"
              aria-label="开始日期"
              @change="onStartDateChange"
            />
            <span class="shrink-0 text-xs text-gray-400">至</span>
            <input
              v-model="filterEndDate"
              type="date"
              class="input usage-quick-modal__date min-w-0 flex-1"
              :min="filterStartDate || undefined"
              aria-label="结束日期"
              @change="onEndDateChange"
            />
          </div>
        </div>
        <div class="w-32 shrink-0">
          <button type="button" class="btn btn-primary w-full" :disabled="loading || refreshing" @click="applyFilters">
            <Icon name="search" size="sm" />
            <span>{{ loading || refreshing ? '查询中' : '搜索' }}</span>
          </button>
        </div>
      </div>

      <div v-if="errorMessage" class="usage-quick-modal__error rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        {{ errorMessage }}
      </div>
      <div class="usage-quick-modal__table">
        <UsageTable
          :data="logs"
          :loading="loading"
          :columns="columns"
          :server-side-sort="false"
          :show-account-billing="false"
          :show-upstream-endpoint="false"
          default-sort-key="created_at"
          default-sort-order="desc"
          flat
        />
      </div>
      <div class="usage-quick-modal__pagination">
        <Pagination
          v-if="pagination.total > 0"
          :page="pagination.page"
          :total="pagination.total"
          :page-size="pagination.pageSize"
          @update:page="onPageChange"
          @update:pageSize="onPageSizeChange"
        />
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import BaseDialog from '@/components/common/BaseDialog.vue'
import Pagination from '@/components/common/Pagination.vue'
import Select from '@/components/common/Select.vue'
import Icon from '@/components/icons/Icon.vue'
import UsageStatsCards from '@/components/admin/usage/UsageStatsCards.vue'
import UsageTable from '@/components/admin/usage/UsageTable.vue'
import type { Column } from '@/components/common/types'
import type { AdminUsageLog, ApiKey, UsageQueryParams, UsageStatsResponse } from '@/types'
import { keysAPI } from '@/api'
import usageAPI from '@/api/usage'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const logs = ref<AdminUsageLog[]>([])
const stats = ref<UsageStatsResponse | null>(null)
const loading = ref(false)
const refreshing = ref(false)
const errorMessage = ref('')
const keys = ref<ApiKey[]>([])
const filterApiKeyId = ref('all')
const filterModel = ref('')
const filterStartDate = ref('')
const filterEndDate = ref('')
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const apiKeyOptions = computed(() => [
  { value: 'all', label: '全部密钥' },
  ...keys.value.map((item) => ({ value: String(item.id), label: item.name })),
])

const columns: Column[] = [
  { key: 'api_key', label: 'API 密钥', sortable: false },
  { key: 'model', label: '模型', sortable: false },
  { key: 'group', label: '分组', sortable: false },
  { key: 'stream', label: '类型', sortable: false },
  { key: 'billing_mode', label: '计费模式', sortable: false },
  { key: 'cost', label: '价格', sortable: false },
  { key: 'image_url', label: '图片', sortable: false },
  { key: 'latency', label: '延迟', sortable: false },
  { key: 'created_at', label: '时间', sortable: false },
]

watch(
  () => props.show,
  (show) => {
    if (show) {
      void loadKeys()
      void loadData()
    }
  },
  { immediate: true },
)

async function loadKeys() {
  try {
    const result = await keysAPI.list(1, 100, { status: 'active' })
    keys.value = result.items || []
  } catch {
    keys.value = []
  }
}

function buildQuery(): UsageQueryParams {
  if (filterStartDate.value && filterEndDate.value && filterStartDate.value > filterEndDate.value) {
    filterStartDate.value = filterEndDate.value
  }
  const params: UsageQueryParams = {
    page: pagination.page,
    page_size: pagination.pageSize,
    sort_by: 'created_at',
    sort_order: 'desc',
  }
  if (filterApiKeyId.value !== 'all') params.api_key_id = Number(filterApiKeyId.value)
  if (filterModel.value.trim()) params.model = filterModel.value.trim()
  if (filterStartDate.value) params.start_date = filterStartDate.value
  if (filterEndDate.value) params.end_date = filterEndDate.value
  return params
}

function onStartDateChange() {
  if (!filterStartDate.value) return
  if (filterEndDate.value && filterStartDate.value > filterEndDate.value) {
    filterEndDate.value = filterStartDate.value
  }
}

function onEndDateChange() {
  if (!filterEndDate.value) return
  if (filterStartDate.value && filterEndDate.value < filterStartDate.value) {
    filterStartDate.value = filterEndDate.value
  }
}

function applyFilters() {
  pagination.page = 1
  void loadData()
}

function onPageChange(page: number) {
  pagination.page = page
  void loadData()
}

function onPageSizeChange(pageSize: number) {
  pagination.pageSize = pageSize
  pagination.page = 1
  void loadData()
}

async function loadData() {
  const initialLoad = logs.value.length === 0
  if (initialLoad) loading.value = true
  else refreshing.value = true
  errorMessage.value = ''
  try {
    const params = buildQuery()
    const page = await usageAPI.query(params)
    logs.value = page.items as AdminUsageLog[]
    pagination.total = page.total
    try {
      stats.value = await usageAPI.getStats(params)
    } catch {
      stats.value = null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载使用记录失败'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}
</script>

<style scoped>
:global(.usage-quick-modal-body) {
  overflow: hidden;
}

.usage-quick-modal {
  display: flex;
  height: calc(90vh - 8rem);
  min-height: 0;
  flex-direction: column;
  gap: 1rem;
}

.usage-quick-modal__stats,
.usage-quick-modal__filters,
.usage-quick-modal__error,
.usage-quick-modal__pagination {
  flex-shrink: 0;
}

.usage-quick-modal__table {
  min-height: 0;
  flex: 1;
  overflow: auto;
  border: 1px solid rgb(229 231 235);
  border-radius: 0.75rem;
  background: rgb(255 255 255);
}

.usage-quick-modal__pagination {
  min-height: 0;
}

.usage-quick-modal__date {
  color-scheme: light;
}

:global(.dark .usage-quick-modal__date) {
  color-scheme: dark;
}

:global(.dark .usage-quick-modal__table) {
  border-color: rgb(55 65 81);
  background: rgb(33 31 28);
}

@media (max-width: 640px) {
  .usage-quick-modal {
    height: calc(95vh - 8rem);
  }

  .usage-quick-modal__filters {
    flex-wrap: wrap;
  }
}
</style>
