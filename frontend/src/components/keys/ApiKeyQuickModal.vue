<template>
  <BaseDialog
    :show="show"
    title="API 密钥"
    width="wide"
    :close-on-click-outside="true"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          创建、切换分组、修改限额、复制和删除都在这里完成。
        </p>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="api-key-create-toggle"
          :disabled="loading || saving"
          @click="openCreateForm"
        >
          <Icon name="plus" size="sm" />
          <span>创建密钥</span>
        </button>
      </div>

      <div v-if="errorMessage && !formOpen" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        {{ errorMessage }}
      </div>
      <div v-if="loading" class="rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-dark-700">
        正在加载密钥…
      </div>
      <div v-else-if="!keys.length" class="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-dark-600">
        还没有 API 密钥，点击右上角创建。
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="item in keys"
          :key="item.id"
          class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-dark-700 dark:bg-dark-800"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="text-sm text-gray-900 dark:text-white">{{ item.name }}</strong>
                <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {{ statusLabel(item.status) }}
                </span>
                <span v-if="item.group?.name" class="text-xs text-gray-500 dark:text-gray-400">
                  {{ item.group.name }}
                </span>
              </div>
              <code class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                {{ maskApiKey(item.key) }}
              </code>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {{ quotaSummary(item) }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button type="button" class="btn btn-secondary btn-sm" @click="copyKey(item)">
                <Icon name="copy" size="sm" />
                <span>{{ copiedId === item.id ? '已复制' : '复制密钥' }}</span>
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :aria-label="`编辑 ${item.name}`"
                title="编辑密钥"
                @click="openEditForm(item)"
              >
                <Icon name="edit" size="sm" />
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm text-red-600 hover:border-red-300 hover:text-red-700 dark:text-red-300 dark:hover:border-red-800 dark:hover:text-red-200"
                :aria-label="`删除 ${item.name}`"
                title="删除密钥"
                :disabled="deleting"
                @click="pendingDelete = item"
              >
                <Icon name="trash" size="sm" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </BaseDialog>

  <BaseDialog
    :show="formOpen"
    :title="formDialogTitle"
    width="wide"
    @close="closeForm"
  >
    <form id="quick-api-key-form" class="space-y-4" data-testid="api-key-form" @submit.prevent="saveForm">
      <div
        class="rounded-lg border px-4 py-3"
        :class="editingKey
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100'
          : 'border-primary-100 bg-primary-50/60 text-primary-900 dark:border-primary-500/20 dark:bg-primary-500/10 dark:text-primary-100'"
      >
        <p class="text-sm font-semibold">
          {{ editingKey ? '正在编辑已有密钥' : '正在创建新密钥' }}
        </p>
        <p v-if="editingKey" class="mt-1 text-xs opacity-80">
          {{ editingKey.name }} · {{ maskApiKey(editingKey.key) }}
        </p>
        <p v-else class="mt-1 text-xs opacity-80">
          保存后会生成一把新的 API 密钥。
        </p>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="block">
          <span class="input-label">名称</span>
          <input
            v-model="form.name"
            data-testid="api-key-name"
            type="text"
            class="input"
            maxlength="64"
            placeholder="例如：图片创作"
          >
        </label>
        <label class="block">
          <span class="input-label">模型分组</span>
          <select
            v-model="form.groupId"
            data-testid="api-key-group"
            class="input"
          >
            <option :value="null" disabled>请选择模型分组</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="input-label">额度限制</span>
          <input
            v-model.number="form.quota"
            data-testid="api-key-quota"
            type="number"
            min="0"
            step="0.01"
            class="input"
            placeholder="留空则不限制额度"
          >
          <span class="input-hint">留空时不限制额度。</span>
        </label>
        <label v-if="!editingKey" class="block">
          <span class="input-label">有效期（天）</span>
          <input
            v-model.number="form.expiresInDays"
            type="number"
            min="1"
            step="1"
            class="input"
            placeholder="留空表示永久"
          >
          <span class="input-hint">创建后仍可到完整密钥页调整到期时间。</span>
        </label>
      </div>

      <div>
        <p class="text-xs font-medium text-gray-700 dark:text-gray-300">调用限额（USD）</p>
        <div class="mt-2 grid gap-3 sm:grid-cols-3">
          <label class="block">
            <span class="input-label">每 5 小时</span>
            <input v-model.number="form.rateLimit5h" type="number" min="0" step="0.01" class="input" placeholder="不限">
          </label>
          <label class="block">
            <span class="input-label">每 1 天</span>
            <input v-model.number="form.rateLimit1d" type="number" min="0" step="0.01" class="input" placeholder="不限">
          </label>
          <label class="block">
            <span class="input-label">每 7 天</span>
            <input v-model.number="form.rateLimit7d" type="number" min="0" step="0.01" class="input" placeholder="不限">
          </label>
        </div>
      </div>

      <p v-if="errorMessage" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        {{ errorMessage }}
      </p>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="saving" @click="closeForm">
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="api-key-save"
          :disabled="saving || !form.name.trim() || form.groupId == null"
          @click="saveForm"
        >
          {{ saving ? '保存中…' : editingKey ? '保存修改' : '创建密钥' }}
        </button>
      </div>
    </template>
  </BaseDialog>

  <ConfirmDialog
    :show="!!pendingDelete"
    title="删除 API 密钥"
    message="删除后无法恢复，确定要继续吗？"
    confirm-text="确认删除"
    danger
    @confirm="deletePendingKey"
    @cancel="pendingDelete = null"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import { keysAPI, userGroupsAPI } from '@/api'
import type { ApiKey, Group } from '@/types'
import { maskApiKey } from '@/utils/maskApiKey'
import { useClipboard } from '@/composables/useClipboard'
import BaseDialog from '@/components/common/BaseDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { onKeysChanged } from '@/utils/creatorKeyEvents'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const { copyToClipboard } = useClipboard()
const keys = ref<ApiKey[]>([])
const groups = ref<Group[]>([])
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const errorMessage = ref('')
const copiedId = ref<number | null>(null)
const pendingDelete = ref<ApiKey | null>(null)
const formOpen = ref(false)
const editingKey = ref<ApiKey | null>(null)
const formDialogTitle = computed(() => editingKey.value ? '编辑 API 密钥' : '创建 API 密钥')
const form = reactive({
  name: '',
  groupId: null as number | null,
  quota: null as number | null,
  expiresInDays: null as number | null,
  rateLimit5h: null as number | null,
  rateLimit1d: null as number | null,
  rateLimit7d: null as number | null,
})

let unsubscribeKeysChanged: (() => void) | undefined

onMounted(() => {
  unsubscribeKeysChanged = onKeysChanged(() => {
    if (props.show && !formOpen.value) void loadData()
  })
})

onBeforeUnmount(() => {
  unsubscribeKeysChanged?.()
  unsubscribeKeysChanged = undefined
})

watch(
  () => props.show,
  (show) => {
    if (show) {
      void loadData()
    } else {
      pendingDelete.value = null
      formOpen.value = false
      editingKey.value = null
      errorMessage.value = ''
    }
  },
  { immediate: true },
)

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [keyResult, groupResult] = await Promise.all([
      keysAPI.list(1, 100),
      userGroupsAPI.getAvailable(),
    ])
    keys.value = keyResult.items || []
    groups.value = groupResult || []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载密钥或模型分组失败'
  } finally {
    loading.value = false
  }
}

function supportsCreativeGroup(group: Group): boolean {
  return group.platform === 'composite' ||
    group.allow_image_generation === true ||
    group.video_price_480p != null ||
    group.video_price_720p != null ||
    group.video_price_1080p != null
}

function nextKeyName(): string {
  const names = new Set(keys.value.map((item) => item.name))
  if (!names.has('创作密钥')) return '创作密钥'
  let index = 2
  while (names.has(`创作密钥 ${index}`)) index += 1
  return `创作密钥 ${index}`
}

function preferredGroupId(): number | null {
  const preferred = groups.value.find(supportsCreativeGroup) || groups.value[0]
  return preferred?.id ?? null
}

function resetForm() {
  form.name = ''
  form.groupId = null
  form.quota = null
  form.expiresInDays = null
  form.rateLimit5h = null
  form.rateLimit1d = null
  form.rateLimit7d = null
}

function openCreateForm() {
  editingKey.value = null
  resetForm()
  form.name = nextKeyName()
  form.groupId = preferredGroupId()
  formOpen.value = true
  errorMessage.value = ''
}

function openEditForm(item: ApiKey) {
  editingKey.value = item
  form.name = item.name
  form.groupId = item.group_id
  form.quota = item.quota > 0 ? item.quota : null
  form.expiresInDays = null
  form.rateLimit5h = item.rate_limit_5h > 0 ? item.rate_limit_5h : null
  form.rateLimit1d = item.rate_limit_1d > 0 ? item.rate_limit_1d : null
  form.rateLimit7d = item.rate_limit_7d > 0 ? item.rate_limit_7d : null
  formOpen.value = true
  errorMessage.value = ''
}

function closeForm() {
  formOpen.value = false
  editingKey.value = null
}

async function saveForm() {
  const name = form.name.trim()
  if (!name) {
    errorMessage.value = '请输入密钥名称'
    return
  }
  if (form.groupId == null) {
    errorMessage.value = '请选择模型分组'
    return
  }

  saving.value = true
  errorMessage.value = ''
  try {
    const quota = Number(form.quota) > 0 ? Number(form.quota) : 0
    const rateLimit5h = Number(form.rateLimit5h) > 0 ? Number(form.rateLimit5h) : 0
    const rateLimit1d = Number(form.rateLimit1d) > 0 ? Number(form.rateLimit1d) : 0
    const rateLimit7d = Number(form.rateLimit7d) > 0 ? Number(form.rateLimit7d) : 0

    if (editingKey.value) {
      await keysAPI.update(editingKey.value.id, {
        name,
        group_id: form.groupId,
        quota,
        rate_limit_5h: rateLimit5h,
        rate_limit_1d: rateLimit1d,
        rate_limit_7d: rateLimit7d,
      })
    } else {
      const expiresInDays = Number(form.expiresInDays) > 0 ? Number(form.expiresInDays) : undefined
      await keysAPI.create(
        name,
        form.groupId,
        undefined,
        undefined,
        undefined,
        quota > 0 ? quota : undefined,
        expiresInDays,
        {
          rate_limit_5h: rateLimit5h || undefined,
          rate_limit_1d: rateLimit1d || undefined,
          rate_limit_7d: rateLimit7d || undefined,
        },
      )
    }
    closeForm()
    await loadData()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存密钥失败'
  } finally {
    saving.value = false
  }
}

function statusLabel(status: ApiKey['status']): string {
  const labels: Record<ApiKey['status'], string> = {
    active: '可用',
    inactive: '已禁用',
    quota_exhausted: '额度用尽',
    expired: '已过期',
  }
  return labels[status]
}

function quotaSummary(item: ApiKey): string {
  const quota = item.quota > 0
    ? `额度限制 $${item.quota.toFixed(2)}，已用 $${item.quota_used.toFixed(2)}`
    : '额度限制不限'
  const limits = [
    item.rate_limit_5h > 0 ? `5h $${item.rate_limit_5h.toFixed(2)}` : '',
    item.rate_limit_1d > 0 ? `1d $${item.rate_limit_1d.toFixed(2)}` : '',
    item.rate_limit_7d > 0 ? `7d $${item.rate_limit_7d.toFixed(2)}` : '',
  ].filter(Boolean)
  return limits.length ? `${quota} · ${limits.join(' / ')}` : quota
}

async function deletePendingKey() {
  const item = pendingDelete.value
  if (!item) return
  deleting.value = true
  errorMessage.value = ''
  try {
    await keysAPI.delete(item.id)
    pendingDelete.value = null
    if (editingKey.value?.id === item.id) closeForm()
    await loadData()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除密钥失败'
  } finally {
    deleting.value = false
  }
}

async function copyKey(item: ApiKey) {
  const ok = await copyToClipboard(item.key, 'API 密钥已复制')
  if (!ok) return
  copiedId.value = item.id
  window.setTimeout(() => {
    if (copiedId.value === item.id) copiedId.value = null
  }, 1800)
}
</script>
