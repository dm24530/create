<template>
  <BaseDialog
    :show="show"
    :title="dialogTitle"
    width="wide"
    @close="requestClose"
  >
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section class="min-w-0">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ t("admin.groups.compositeRoutes.routes") }}
          </h3>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-testid="composite-routes-refresh"
            :disabled="routesLoading"
            @click="loadCompositeRoutes"
          >
            <Icon
              name="refresh"
              size="sm"
              :class="routesLoading ? 'animate-spin' : ''"
            />
          </button>
        </div>

        <div
          class="overflow-hidden rounded-lg border border-gray-200 dark:border-dark-600"
        >
          <div
            v-if="routesLoading"
            class="flex h-36 items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            {{ t("common.loading") }}
          </div>
          <div
            v-else-if="routes.length === 0"
            class="flex h-36 items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            {{ t("admin.groups.compositeRoutes.empty") }}
          </div>
          <div v-else class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-dark-600">
              <thead class="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-dark-800 dark:text-gray-400">
                <tr>
                  <th class="px-3 py-2">
                    {{ t("admin.groups.compositeRoutes.publicModel") }}
                  </th>
                  <th class="px-3 py-2">
                    {{ t("admin.groups.compositeRoutes.target") }}
                  </th>
                  <th class="px-3 py-2">
                    {{ t("admin.groups.compositeRoutes.scope") }}
                  </th>
                  <th class="px-3 py-2 text-right">
                    {{ t("admin.groups.columns.actions") }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 bg-white dark:divide-dark-700 dark:bg-dark-900">
                <tr
                  v-for="route in routes"
                  :key="route.id"
                  data-testid="composite-route-row"
                  :class="!route.enabled && 'opacity-60'"
                >
                  <td class="max-w-[15rem] px-3 py-2">
                    <div class="break-all font-medium text-gray-900 dark:text-white">
                      {{ route.public_model }}
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                      <span class="badge badge-gray">{{
                        compositeRouteMatchLabel(route.match_type)
                      }}</span>
                      <span
                        v-if="!route.enabled"
                        class="badge badge-danger"
                      >
                        {{ t("admin.accounts.status.inactive") }}
                      </span>
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-1.5 text-gray-900 dark:text-white">
                      <PlatformIcon :platform="route.target_platform" size="xs" />
                      <span>{{ formatCompositePlatform(route.target_platform) }}</span>
                    </div>
                    <div class="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
                      {{ route.upstream_model || route.public_model }}
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <div class="text-gray-700 dark:text-gray-300">
                      {{ formatCompositeEndpoint(route.endpoint) }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      {{ t("admin.groups.compositeRoutes.priority") }}:
                      {{ route.priority }}
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex justify-end gap-1">
                      <button
                        type="button"
                        data-testid="composite-route-edit"
                        class="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-dark-700 dark:hover:text-primary-400"
                        :title="t('common.edit')"
                        @click="editCompositeRoute(route)"
                      >
                        <Icon name="edit" size="sm" />
                      </button>
                      <button
                        type="button"
                        data-testid="composite-route-delete"
                        class="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        :title="t('common.delete')"
                        @click="deleteCompositeRoute(route)"
                      >
                        <Icon name="trash" size="sm" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="space-y-5">
        <form class="space-y-3" @submit.prevent="saveCompositeRoute">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
              {{
                editingRouteId
                  ? t("admin.groups.compositeRoutes.editRoute")
                  : t("admin.groups.compositeRoutes.addRoute")
              }}
            </h3>
            <button
              v-if="editingRouteId"
              type="button"
              class="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              @click="resetCompositeRouteForm"
            >
              {{ t("common.cancel") }}
            </button>
          </div>

          <div>
            <label class="input-label">{{
              t("admin.groups.compositeRoutes.publicModel")
            }}</label>
            <input
              v-model.trim="routeForm.public_model"
              data-testid="composite-route-public-model"
              type="text"
              class="input"
              required
              placeholder="openrouter/gpt-5"
            />
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="input-label">{{
                t("admin.groups.compositeRoutes.matchType")
              }}</label>
              <Select
                v-model="routeForm.match_type"
                :options="compositeRouteMatchOptions"
              />
            </div>
            <div>
              <label class="input-label">{{
                t("admin.groups.compositeRoutes.endpoint")
              }}</label>
              <Select
                v-model="routeForm.endpoint"
                :options="compositeRouteEndpointOptions"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="input-label">{{
                t("admin.groups.compositeRoutes.targetPlatform")
              }}</label>
              <Select
                v-model="routeForm.target_platform"
                :options="compositeRoutePlatformOptions"
              />
            </div>
            <div>
              <label class="input-label">{{
                t("admin.groups.compositeRoutes.priority")
              }}</label>
              <input
                v-model.number="routeForm.priority"
                data-testid="composite-route-priority"
                type="number"
                min="1"
                step="1"
                class="input"
              />
            </div>
          </div>

          <div>
            <label class="input-label">{{
              t("admin.groups.compositeRoutes.upstreamModel")
            }}</label>
            <input
              v-model.trim="routeForm.upstream_model"
              data-testid="composite-route-upstream-model"
              type="text"
              class="input"
              placeholder="gpt-5"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ t("admin.groups.compositeRoutes.upstreamModelHint") }}
            </p>
          </div>

          <div>
            <label class="input-label">{{
              t("admin.groups.compositeRoutes.notes")
            }}</label>
            <textarea
              v-model.trim="routeForm.notes"
              data-testid="composite-route-notes"
              rows="2"
              class="input"
            ></textarea>
          </div>

          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                v-model="routeForm.enabled"
                data-testid="composite-route-enabled"
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 dark:border-dark-600 dark:bg-dark-700"
              />
              {{ t("admin.groups.compositeRoutes.enabled") }}
            </label>
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="composite-route-save"
              :disabled="routeSaving"
            >
              <Icon
                v-if="!routeSaving"
                name="check"
                size="sm"
                class="mr-2"
              />
              {{ editingRouteId ? t("common.update") : t("common.create") }}
            </button>
          </div>
        </form>

        <div class="border-t border-gray-200 pt-4 dark:border-dark-600">
          <h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            {{ t("admin.groups.compositeRoutes.preview") }}
          </h3>
          <div class="space-y-3">
            <input
              v-model.trim="previewModel"
              data-testid="composite-route-preview-model"
              type="text"
              class="input"
              placeholder="openrouter/gpt-5"
              @keyup.enter="previewCompositeRoute"
            />
            <div class="flex gap-2">
              <Select
                v-model="previewEndpoint"
                :options="compositeRouteEndpointOptions"
                class="min-w-0 flex-1"
              />
              <button
                type="button"
                class="btn btn-secondary"
                data-testid="composite-route-preview-button"
                :disabled="previewLoading || !previewModel"
                @click="previewCompositeRoute"
              >
                <Icon name="play" size="sm" />
              </button>
            </div>

            <div
              v-if="previewDecision"
              data-testid="composite-route-preview-result"
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-dark-600 dark:bg-dark-800"
            >
              <div class="mb-2 flex items-center gap-2">
                <span
                  :class="[
                    'badge',
                    previewDecision.matched
                      ? 'badge-success'
                      : 'badge-danger',
                  ]"
                >
                  {{
                    previewDecision.matched
                      ? t("admin.groups.compositeRoutes.matched")
                      : t("admin.groups.compositeRoutes.notMatched")
                  }}
                </span>
                <span class="badge badge-gray">
                  {{ compositeRouteSourceLabel(previewDecision.source) }}
                </span>
              </div>
              <div
                v-if="previewDecision.matched"
                class="space-y-1 text-gray-700 dark:text-gray-300"
              >
                <div>
                  {{ t("admin.groups.compositeRoutes.targetPlatform") }}:
                  {{ formatCompositePlatform(previewDecision.target_platform) }}
                </div>
                <div class="break-all">
                  {{ t("admin.groups.compositeRoutes.upstreamModel") }}:
                  {{ previewDecision.upstream_model }}
                </div>
              </div>
              <div
                v-else
                class="text-gray-500 dark:text-gray-400"
              >
                {{ previewDecision.reason }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="flex justify-end pt-4">
        <button
          type="button"
          class="btn btn-secondary"
          @click="requestClose"
        >
          {{ t("common.close") }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { adminAPI } from "@/api/admin";
import type {
  AdminGroup,
  CompositeModelRoute,
  CompositeModelRouteInput,
  CompositeRouteDecision,
  CompositeRouteEndpoint,
  CompositeRouteMatchType,
  GroupPlatform,
} from "@/types";
import { CONCRETE_PLATFORM_OPTIONS } from "@/constants/platforms";
import { platformLabel } from "@/utils/platformColors";
import { useAppStore } from "@/stores/app";
import BaseDialog from "@/components/common/BaseDialog.vue";
import Select from "@/components/common/Select.vue";
import PlatformIcon from "@/components/common/PlatformIcon.vue";
import Icon from "@/components/icons/Icon.vue";

const props = defineProps<{
  show: boolean;
  group: AdminGroup | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

type ConcreteGroupPlatform = Exclude<GroupPlatform, "composite">;
type CompositeRouteFormState = {
  public_model: string;
  match_type: CompositeRouteMatchType;
  target_platform: ConcreteGroupPlatform;
  upstream_model: string;
  endpoint: CompositeRouteEndpoint;
  priority: number;
  enabled: boolean;
  notes: string;
};

const { t } = useI18n();
const appStore = useAppStore();
const routes = ref<CompositeModelRoute[]>([]);
const routesLoading = ref(false);
const routeSaving = ref(false);
const editingRouteId = ref<number | null>(null);
const previewModel = ref("");
const previewEndpoint = ref<CompositeRouteEndpoint>("any");
const previewLoading = ref(false);
const previewDecision = ref<CompositeRouteDecision | null>(null);
const routeForm = reactive<CompositeRouteFormState>(createEmptyRouteForm());

const dialogTitle = computed(() =>
  props.group
    ? t("admin.groups.compositeRoutes.titleWithGroup", {
        name: props.group.name,
      })
    : t("admin.groups.compositeRoutes.title"),
);

const compositeRoutePlatformOptions = computed(() => [
  ...CONCRETE_PLATFORM_OPTIONS,
]);

const compositeRouteEndpointOptions = computed(() => [
  { value: "any", label: t("admin.groups.compositeRoutes.endpoints.any") },
  {
    value: "messages",
    label: t("admin.groups.compositeRoutes.endpoints.messages"),
  },
  {
    value: "count_tokens",
    label: t("admin.groups.compositeRoutes.endpoints.countTokens"),
  },
  {
    value: "responses",
    label: t("admin.groups.compositeRoutes.endpoints.responses"),
  },
  {
    value: "chat_completions",
    label: t("admin.groups.compositeRoutes.endpoints.chatCompletions"),
  },
  {
    value: "embeddings",
    label: t("admin.groups.compositeRoutes.endpoints.embeddings"),
  },
  { value: "images", label: t("admin.groups.compositeRoutes.endpoints.images") },
  { value: "gemini", label: t("admin.groups.compositeRoutes.endpoints.gemini") },
]);

const compositeRouteMatchOptions = computed(() => [
  { value: "exact", label: t("admin.groups.compositeRoutes.match.exact") },
  { value: "prefix", label: t("admin.groups.compositeRoutes.match.prefix") },
]);

watch(
  [() => props.show, () => props.group?.id],
  async ([show, groupID]) => {
    if (!show || !groupID) return;
    resetDialogState();
    await loadCompositeRoutes();
  },
  { immediate: true },
);

function createEmptyRouteForm(): CompositeRouteFormState {
  return {
    public_model: "",
    match_type: "exact",
    target_platform: "openai",
    upstream_model: "",
    endpoint: "any",
    priority: 100,
    enabled: true,
    notes: "",
  };
}

function resetDialogState() {
  routes.value = [];
  previewModel.value = "";
  previewEndpoint.value = "any";
  previewDecision.value = null;
  resetCompositeRouteForm();
}

function requestClose() {
  emit("close");
}

function compositeRouteMatchLabel(matchType: CompositeRouteMatchType) {
  return (
    compositeRouteMatchOptions.value.find(
      (option) => option.value === matchType,
    )?.label || matchType
  );
}

function formatCompositeEndpoint(endpoint: CompositeRouteEndpoint) {
  return (
    compositeRouteEndpointOptions.value.find(
      (option) => option.value === endpoint,
    )?.label || endpoint
  );
}

function formatCompositePlatform(platform: string) {
  if (!platform) return "—";
  return t(`admin.groups.platforms.${platform}`, platformLabel(platform));
}

function compositeRouteSourceLabel(source: string) {
  if (source === "route") {
    return t("admin.groups.compositeRoutes.sources.route");
  }
  if (source === "detector") {
    return t("admin.groups.compositeRoutes.sources.detector");
  }
  return source || "—";
}

function resetCompositeRouteForm() {
  editingRouteId.value = null;
  Object.assign(routeForm, createEmptyRouteForm());
}

function toCompositeRouteInput(): CompositeModelRouteInput {
  return {
    public_model: routeForm.public_model.trim(),
    match_type: routeForm.match_type,
    target_platform: routeForm.target_platform,
    upstream_model: routeForm.upstream_model.trim(),
    endpoint: routeForm.endpoint,
    priority: Number(routeForm.priority) || 100,
    enabled: routeForm.enabled,
    notes: routeForm.notes.trim(),
  };
}

async function loadCompositeRoutes() {
  if (!props.group) return;
  routesLoading.value = true;
  try {
    const nextRoutes = await adminAPI.groups.listCompositeRoutes(props.group.id);
    routes.value = nextRoutes.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id - b.id;
    });
  } catch (error: any) {
    appStore.showError(
      error.response?.data?.detail ||
        error.response?.data?.message ||
        t("admin.groups.compositeRoutes.failedToLoad"),
    );
    console.error("Error loading composite routes:", error);
  } finally {
    routesLoading.value = false;
  }
}

function editCompositeRoute(route: CompositeModelRoute) {
  editingRouteId.value = route.id;
  routeForm.public_model = route.public_model;
  routeForm.match_type = route.match_type;
  routeForm.target_platform = route.target_platform;
  routeForm.upstream_model = route.upstream_model;
  routeForm.endpoint = route.endpoint;
  routeForm.priority = route.priority || 100;
  routeForm.enabled = route.enabled;
  routeForm.notes = route.notes || "";
}

async function saveCompositeRoute() {
  if (!props.group) return;
  if (!routeForm.public_model.trim()) {
    appStore.showError(t("admin.groups.compositeRoutes.publicModelRequired"));
    return;
  }
  routeSaving.value = true;
  try {
    const payload = toCompositeRouteInput();
    if (editingRouteId.value) {
      await adminAPI.groups.updateCompositeRoute(
        props.group.id,
        editingRouteId.value,
        payload,
      );
      appStore.showSuccess(t("admin.groups.compositeRoutes.routeUpdated"));
    } else {
      await adminAPI.groups.createCompositeRoute(props.group.id, payload);
      appStore.showSuccess(t("admin.groups.compositeRoutes.routeCreated"));
    }
    resetCompositeRouteForm();
    await loadCompositeRoutes();
  } catch (error: any) {
    appStore.showError(
      error.response?.data?.detail ||
        error.response?.data?.message ||
        t("admin.groups.compositeRoutes.failedToSave"),
    );
    console.error("Error saving composite route:", error);
  } finally {
    routeSaving.value = false;
  }
}

async function deleteCompositeRoute(route: CompositeModelRoute) {
  if (!props.group) return;
  if (!window.confirm(t("admin.groups.compositeRoutes.deleteConfirm"))) return;
  try {
    await adminAPI.groups.deleteCompositeRoute(props.group.id, route.id);
    if (editingRouteId.value === route.id) {
      resetCompositeRouteForm();
    }
    appStore.showSuccess(t("admin.groups.compositeRoutes.routeDeleted"));
    await loadCompositeRoutes();
  } catch (error: any) {
    appStore.showError(
      error.response?.data?.detail ||
        error.response?.data?.message ||
        t("admin.groups.compositeRoutes.failedToDelete"),
    );
    console.error("Error deleting composite route:", error);
  }
}

async function previewCompositeRoute() {
  if (!props.group || !previewModel.value.trim()) {
    return;
  }
  previewLoading.value = true;
  try {
    previewDecision.value = await adminAPI.groups.previewCompositeRoute(
      props.group.id,
      {
        model: previewModel.value.trim(),
        endpoint: previewEndpoint.value,
      },
    );
  } catch (error: any) {
    appStore.showError(
      error.response?.data?.detail ||
        error.response?.data?.message ||
        t("admin.groups.compositeRoutes.failedToPreview"),
    );
    console.error("Error previewing composite route:", error);
  } finally {
    previewLoading.value = false;
  }
}
</script>
