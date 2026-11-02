<template>
  <BaseDialog
    :show="show"
    :title="t('admin.groups.sortOrder')"
    width="normal"
    @close="requestClose"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t("admin.groups.sortOrderHint") }}
      </p>
      <VueDraggable
        v-model="sortableGroups"
        :animation="200"
        class="space-y-2"
      >
        <div
          v-for="group in sortableGroups"
          :key="group.id"
          class="flex cursor-grab items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-shadow hover:shadow-md active:cursor-grabbing dark:border-dark-600 dark:bg-dark-700"
        >
          <div class="text-gray-400">
            <Icon name="menu" size="md" />
          </div>
          <div class="flex-1">
            <div class="font-medium text-gray-900 dark:text-white">
              {{ group.name }}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              <span
                :class="[
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                  group.platform === 'anthropic'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : group.platform === 'openai'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : group.platform === 'antigravity'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        : group.platform === 'grok'
                          ? 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100'
                          : group.platform === 'kimi'
                            ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400'
                            : group.platform === 'zhipu'
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                              : group.platform === 'deepseek'
                                ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
                                : group.platform === 'minimax'
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                  : group.platform === 'opencode_go'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                ]"
              >
                {{ t("admin.groups.platforms." + group.platform, platformLabel(group.platform)) }}
              </span>
            </div>
          </div>
          <div class="text-sm text-gray-400">#{{ group.id }}</div>
        </div>
      </VueDraggable>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 pt-4">
        <button
          type="button"
          class="btn btn-secondary"
          @click="requestClose"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="group-sort-save"
          :disabled="saving"
          @click="saveSortOrder"
        >
          <svg
            v-if="saving"
            class="-ml-1 mr-2 h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {{ saving ? t("common.saving") : t("common.save") }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { VueDraggable } from "vue-draggable-plus";
import { adminAPI } from "@/api/admin";
import type { AdminGroup } from "@/types";
import { platformLabel } from "@/utils/platformColors";
import { useAppStore } from "@/stores/app";
import BaseDialog from "@/components/common/BaseDialog.vue";
import Icon from "@/components/icons/Icon.vue";

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const { t } = useI18n();
const appStore = useAppStore();
const sortableGroups = ref<AdminGroup[]>([]);
const saving = ref(false);

watch(
  () => props.show,
  async (show) => {
    if (show) {
      await loadGroups();
    }
  },
  { immediate: true },
);

function requestClose() {
  emit("close");
}

async function loadGroups() {
  try {
    const allGroups = await adminAPI.groups.getAll();
    sortableGroups.value = [...allGroups].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
  } catch (error) {
    appStore.showError(t("admin.groups.failedToLoad"));
    console.error("Error loading groups for sorting:", error);
    emit("close");
  }
}

async function saveSortOrder() {
  saving.value = true;
  try {
    const updates = sortableGroups.value.map((group, index) => ({
      id: group.id,
      sort_order: index * 10,
    }));
    await adminAPI.groups.updateSortOrder(updates);
    appStore.showSuccess(t("admin.groups.sortOrderUpdated"));
    emit("saved");
    emit("close");
  } catch (error: any) {
    appStore.showError(
      error.response?.data?.detail || t("admin.groups.failedToUpdateSortOrder"),
    );
    console.error("Error updating sort order:", error);
  } finally {
    saving.value = false;
  }
}
</script>
