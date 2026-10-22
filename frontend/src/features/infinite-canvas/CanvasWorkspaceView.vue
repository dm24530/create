<template>
  <AppLayout>
    <div class="canvas-workspace">
      <header class="canvas-workspace__header">
        <div class="flex min-w-0 items-center gap-3">
          <button type="button" class="canvas-icon-button" title="返回画布列表" @click="router.push('/canvas')">
            <Icon name="arrowLeft" size="sm" />
          </button>
          <div class="min-w-0">
            <input
              v-model="store.title"
              class="canvas-workspace__title"
              aria-label="画布名称"
            />
            <div class="mt-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span>{{ saveLabel }}</span>
              <span class="h-1 w-1 rounded-full bg-gray-400" />
              <span>{{ nodes.length }} 个节点</span>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <label class="canvas-key-select">
            <span>API Key</span>
            <select
              :value="store.selectedKeyId"
              :disabled="!store.availableKeys.length"
              @change="changeCreatorKey"
            >
              <option v-if="!store.availableKeys.length" value="">暂无可用密钥</option>
              <option v-for="key in store.availableKeys" :key="key.id" :value="String(key.id)">
                {{ key.name }} · {{ key.group?.name || '未分组' }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="canvas-tool-button"
            :disabled="!store.imageModels.length"
            @click="addNode('image-generator')"
          >
            <Icon name="grid" size="xs" />
            图片节点
          </button>
          <button
            type="button"
            class="canvas-tool-button"
            :disabled="!store.videoModels.length"
            @click="addNode('video-generator')"
          >
            <Icon name="play" size="xs" />
            视频节点
          </button>
          <button type="button" class="canvas-tool-button" @click="addNode('text')">
            <Icon name="document" size="xs" />
            文本
          </button>
          <button type="button" class="canvas-tool-button" @click="fitCanvas">
            <Icon name="expand" size="xs" />
            适应画布
          </button>
          <button type="button" class="canvas-tool-button canvas-tool-button--primary" :disabled="saveState === 'saving'" @click="saveNow">
            {{ saveState === 'saving' ? '保存中...' : '保存' }}
          </button>
        </div>
      </header>

      <div v-if="store.generationError" class="canvas-workspace__banner">
        {{ store.generationError }}
      </div>
      <div v-else-if="saveState === 'error'" class="canvas-workspace__banner canvas-workspace__banner--error">
        {{ store.saveError || '画布保存失败' }}
      </div>

      <div class="canvas-workspace__body">
        <VueFlow
          v-model:nodes="store.nodes"
          v-model:edges="store.edges"
          class="canvas-flow"
          :min-zoom="0.08"
          :max-zoom="2.5"
          :default-viewport="store.viewport"
          :connect-on-click="false"
          fit-view-on-init
          @connect="onConnect"
          @viewport-change-end="onViewportChange"
          @node-click="selectedNodeId = $event.node.id"
          @pane-click="selectedNodeId = ''"
        >
          <template #node-image-generator="nodeProps">
            <CanvasGeneratorNode v-bind="nodeProps" />
          </template>
          <template #node-video-generator="nodeProps">
            <CanvasGeneratorNode v-bind="nodeProps" />
          </template>
          <template #node-text="nodeProps">
            <CanvasTextNode v-bind="nodeProps" />
          </template>

          <MiniMap
            position="bottom-right"
            :pannable="true"
            :zoomable="true"
            class="canvas-minimap"
          />

          <div v-if="!nodes.length && !store.loading" class="canvas-empty">
            <div class="canvas-empty__icon"><Icon name="sparkles" size="lg" /></div>
            <h2>开始你的第一张创作画布</h2>
            <p>添加图片或视频生成节点，填写提示词后直接调用当前平台模型。</p>
            <div class="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                class="canvas-tool-button canvas-tool-button--primary"
                :disabled="!store.imageModels.length"
                @click="addNode('image-generator')"
              >生成图片</button>
              <button
                type="button"
                class="canvas-tool-button"
                :disabled="!store.videoModels.length"
                @click="addNode('video-generator')"
              >生成视频</button>
            </div>
          </div>
        </VueFlow>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow, type Connection, type ViewportTransform } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import CanvasGeneratorNode from './CanvasGeneratorNode.vue'
import CanvasTextNode from './CanvasTextNode.vue'
import { useCanvasWorkspaceStore } from './canvasWorkspaceStore'
import type { CanvasNodeKind } from '@/types/canvas'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const store = useCanvasWorkspaceStore()
const { screenToFlowCoordinate, fitView } = useVueFlow()
const selectedNodeId = ref('')

const nodes = computed(() => store.nodes)
const saveState = computed(() => store.saveState)
const saveLabel = computed(() => {
  switch (store.saveState) {
    case 'saving': return '正在保存'
    case 'saved': return '已保存到服务器'
    case 'error': return '保存失败'
    default: return '等待保存'
  }
})

watch(
  [() => store.nodes, () => store.edges],
  () => {
    if (store.projectId) store.scheduleSave()
  },
  { deep: true },
)

function onConnect(connection: Connection) {
  store.connect({
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  })
}

function onViewportChange(viewport: ViewportTransform) {
  store.viewport = viewport
  store.scheduleSave()
}

function addNode(kind: CanvasNodeKind) {
  const point = screenToFlowCoordinate({
    x: Math.max(240, window.innerWidth / 2),
    y: Math.max(180, window.innerHeight / 2),
  })
  const jitter = store.nodes.length % 5
  const node = store.addNode(kind, {
    x: point.x - 165 + jitter * 32,
    y: point.y - 180 + jitter * 24,
  })
  selectedNodeId.value = node.id
}

function fitCanvas() {
  void fitView({ padding: 0.2, duration: 350 })
}

async function saveNow() {
  const ok = await store.saveProject()
  if (ok) appStore.showSuccess('画布已保存')
  else appStore.showError(store.saveError || '画布保存失败')
}

async function changeCreatorKey(event: Event) {
  const keyId = (event.target as HTMLSelectElement).value
  try {
    await store.selectCreatorKey(keyId)
    appStore.showSuccess('已切换创作密钥')
  } catch (error) {
    appStore.showError(error instanceof Error ? error.message : '切换创作密钥失败')
  }
}

onMounted(async () => {
  const id = String(route.params.projectId || '')
  if (!id) {
    await router.replace('/canvas')
    return
  }
  try {
    await store.loadProject(id)
  } catch (error) {
    appStore.showError(error instanceof Error ? error.message : '加载画布失败')
    await router.replace('/canvas')
  }
})
</script>

<style scoped>
.canvas-workspace {
  display: flex;
  height: calc(100vh - 9.5rem);
  min-height: 620px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  background: #0d1219;
  box-shadow: 0 18px 55px rgba(15, 23, 42, 0.18);
}

.canvas-workspace__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  padding: 12px 14px;
  background: rgba(15, 21, 30, 0.96);
}

.canvas-workspace__title {
  width: min(48vw, 420px);
  border: 0;
  background: transparent;
  color: #f8fafc;
  font-size: 15px;
  font-weight: 700;
  outline: none;
}

.canvas-icon-button,
.canvas-tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: rgba(148, 163, 184, 0.06);
  padding: 7px 10px;
  color: #cbd5e1;
  font-size: 11px;
  transition: 150ms ease;
}

.canvas-key-select {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: rgba(148, 163, 184, 0.06);
  padding: 6px 8px;
  color: #94a3b8;
  font-size: 10px;
}

.canvas-key-select select {
  max-width: 190px;
  border: 0;
  background: transparent;
  color: #e2e8f0;
  font-size: 11px;
  outline: none;
}

.canvas-key-select option {
  background: #111827;
  color: #e5e7eb;
}

.canvas-icon-button {
  width: 30px;
  height: 30px;
  padding: 0;
}

.canvas-tool-button:hover,
.canvas-icon-button:hover {
  border-color: rgba(251, 146, 60, 0.45);
  background: rgba(251, 146, 60, 0.09);
  color: #fdba74;
}

.canvas-tool-button--primary {
  border-color: rgba(251, 146, 60, 0.4);
  background: linear-gradient(135deg, #f97316, #fb923c);
  color: #111827;
  font-weight: 700;
}

.canvas-tool-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.canvas-workspace__banner {
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
  background: rgba(14, 165, 233, 0.1);
  padding: 8px 14px;
  color: #bae6fd;
  font-size: 11px;
}

.canvas-workspace__banner--error {
  border-color: rgba(248, 113, 113, 0.24);
  background: rgba(239, 68, 68, 0.1);
  color: #fecaca;
}

.canvas-workspace__body {
  position: relative;
  min-height: 0;
  flex: 1;
  background:
    linear-gradient(rgba(148, 163, 184, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.055) 1px, transparent 1px),
    radial-gradient(circle at 50% 0%, rgba(251, 146, 60, 0.05), transparent 40%),
    #0a0f16;
  background-size: 32px 32px, 32px 32px, auto, auto;
}

.canvas-flow {
  height: 100%;
  width: 100%;
}

.canvas-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(420px, calc(100% - 48px));
  transform: translate(-50%, -50%);
  text-align: center;
  color: #94a3b8;
}

.canvas-empty__icon {
  display: flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  border: 1px solid rgba(251, 146, 60, 0.2);
  border-radius: 13px;
  background: rgba(251, 146, 60, 0.08);
  color: #fb923c;
}

.canvas-empty h2 {
  color: #f1f5f9;
  font-size: 18px;
  font-weight: 650;
}

.canvas-empty p {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.65;
}

:deep(.vue-flow__edge-path) {
  stroke: rgba(148, 163, 184, 0.58);
  stroke-width: 1.6;
}

:deep(.vue-flow__connection-path) {
  stroke: #fb923c;
}

:deep(.vue-flow__minimap) {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 9px;
  background: rgba(10, 15, 22, 0.9);
}

@media (max-width: 768px) {
  .canvas-workspace {
    height: calc(100vh - 8rem);
    min-height: 540px;
  }

  .canvas-workspace__title {
    width: min(54vw, 280px);
  }

  .canvas-workspace__header {
    align-items: flex-start;
  }
}
</style>
