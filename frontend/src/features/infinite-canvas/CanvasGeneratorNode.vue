<template>
  <div class="canvas-node" :class="{ 'canvas-node--selected': selected, 'canvas-node--running': data.status === 'running' }">
    <Handle type="target" :position="Position.Left" class="canvas-handle canvas-handle--target" />

    <header class="canvas-node__header">
      <div class="min-w-0">
        <p class="canvas-node__eyebrow">{{ data.kind === 'video-generator' ? 'VIDEO' : 'IMAGE' }}</p>
        <input
          v-model="label"
          class="canvas-node__title nodrag"
          :aria-label="'节点名称'"
          @change="commitLabel"
        />
      </div>
      <span class="canvas-node__status" :class="statusClass">{{ statusLabel }}</span>
      <button type="button" class="canvas-node__delete nodrag" title="删除节点" @click.stop="store.removeNode(id)">
        ×
      </button>
    </header>

    <div class="canvas-node__body">
      <label class="canvas-field">
        <span>模型</span>
        <select v-model="model" class="canvas-field__control nodrag" @change="commitSettings">
          <option v-if="!model" value="">暂无可用模型</option>
          <option v-for="item in modelOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>

      <label class="canvas-field">
        <span>提示词</span>
        <textarea
          v-model="prompt"
          class="canvas-field__control canvas-field__textarea nodrag nowheel"
          rows="4"
          placeholder="描述你想生成的画面"
          @input="commitPrompt"
        />
      </label>

      <div v-if="data.kind === 'image-generator'" class="canvas-node__options">
        <label class="canvas-field canvas-field--compact">
          <span>尺寸</span>
          <select v-model="size" class="canvas-field__control nodrag" @change="commitSettings">
            <option value="1024x1024">1:1</option>
            <option value="1536x1024">3:2</option>
            <option value="1024x1536">2:3</option>
            <option value="1792x1024">16:9</option>
            <option value="1024x1792">9:16</option>
          </select>
        </label>
      </div>

      <div v-else class="canvas-node__options">
        <label class="canvas-field canvas-field--compact">
          <span>时长</span>
          <select v-model.number="duration" class="canvas-field__control nodrag" @change="commitSettings">
            <option :value="5">5 秒</option>
            <option :value="10">10 秒</option>
          </select>
        </label>
        <label class="canvas-field canvas-field--compact">
          <span>比例</span>
          <select v-model="aspectRatio" class="canvas-field__control nodrag" @change="commitSettings">
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
          </select>
        </label>
      </div>

      <p v-if="incomingReferences.length" class="canvas-node__hint">
        已连接 {{ incomingReferences.length }} 个上游图片，将作为参考输入
      </p>

      <div v-if="data.error" class="canvas-node__error">{{ data.error }}</div>

      <div v-if="data.resultUrl" class="canvas-node__result">
        <img
          v-if="data.kind === 'image-generator'"
          :src="data.resultUrl"
          alt=""
          draggable="false"
        />
        <video
          v-else
          :src="data.resultUrl"
          controls
          preload="metadata"
          @pointerdown.stop
        />
      </div>

      <button
        type="button"
        class="canvas-node__generate nodrag"
        :disabled="data.status === 'running' || !data.prompt.trim() || !data.model"
        @click.stop="generate"
      >
        {{ data.status === 'running' ? '生成中...' : data.kind === 'video-generator' ? '生成视频' : '生成图片' }}
      </button>
    </div>

    <Handle type="source" :position="Position.Right" class="canvas-handle canvas-handle--source" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasWorkspaceStore } from './canvasWorkspaceStore'
import type { CanvasNodeData } from '@/types/canvas'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const store = useCanvasWorkspaceStore()
const label = ref(props.data.label)
const prompt = ref(props.data.prompt)
const model = ref(props.data.model)
const size = ref(props.data.size || '1024x1024')
const duration = ref(props.data.durationSeconds || 5)
const aspectRatio = ref(props.data.aspectRatio || '16:9')

watch(
  () => props.data,
  (value) => {
    label.value = value.label
    prompt.value = value.prompt
    model.value = value.model
    size.value = value.size || '1024x1024'
    duration.value = value.durationSeconds || 5
    aspectRatio.value = value.aspectRatio || '16:9'
  },
  { deep: true },
)

const modelOptions = computed(() => (
  props.data.kind === 'video-generator' ? store.videoModels : store.imageModels
))
const statusLabel = computed(() => {
  switch (props.data.status) {
    case 'running': return '生成中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return '待生成'
  }
})
const statusClass = computed(() => `canvas-node__status--${props.data.status}`)
const incomingReferences = computed(() => store.incomingImageReferences(props.id))

function commitLabel() {
  store.updateNodeData(props.id, { label: label.value.trim() || props.data.label })
}

function commitPrompt() {
  store.updateNodeData(props.id, { prompt: prompt.value })
}

function commitSettings() {
  store.updateNodeData(props.id, {
    model: model.value,
    size: size.value,
    durationSeconds: Number(duration.value),
    aspectRatio: aspectRatio.value,
  })
}

async function generate() {
  commitSettings()
  commitPrompt()
  await store.generateNode(props.id)
}
</script>

<style scoped>
.canvas-node {
  width: 330px;
  min-height: 360px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  background: rgba(18, 24, 33, 0.96);
  color: #e5e7eb;
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(18px);
}

.canvas-node--selected {
  border-color: rgba(251, 146, 60, 0.85);
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(251, 146, 60, 0.2);
}

.canvas-node--running {
  border-color: rgba(56, 189, 248, 0.65);
}

.canvas-node__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px 11px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}

.canvas-node__eyebrow {
  margin: 0 0 3px;
  color: #fb923c;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.canvas-node__title {
  width: 100%;
  border: 0;
  background: transparent;
  color: #f8fafc;
  font-size: 14px;
  font-weight: 650;
  outline: none;
}

.canvas-node__status {
  margin-left: auto;
  border-radius: 999px;
  padding: 3px 7px;
  font-size: 10px;
  white-space: nowrap;
}

.canvas-node__status--idle { background: rgba(148, 163, 184, 0.12); color: #94a3b8; }
.canvas-node__status--running { background: rgba(14, 165, 233, 0.16); color: #7dd3fc; }
.canvas-node__status--completed { background: rgba(34, 197, 94, 0.14); color: #86efac; }
.canvas-node__status--failed { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }

.canvas-node__delete {
  width: 23px;
  height: 23px;
  border: 0;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.08);
  color: #94a3b8;
  font-size: 18px;
  line-height: 1;
}

.canvas-node__delete:hover {
  background: rgba(239, 68, 68, 0.16);
  color: #fca5a5;
}

.canvas-node__body {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 13px 14px 14px;
}

.canvas-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #94a3b8;
  font-size: 11px;
}

.canvas-field__control {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(9, 13, 20, 0.86);
  padding: 8px 9px;
  color: #e5e7eb;
  font-size: 12px;
  outline: none;
}

.canvas-field__control:focus {
  border-color: rgba(251, 146, 60, 0.55);
}

.canvas-field__textarea {
  min-height: 82px;
  resize: vertical;
  line-height: 1.55;
}

.canvas-node__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.canvas-node__options:has(.canvas-field:only-child) {
  grid-template-columns: 1fr;
}

.canvas-node__hint {
  margin: 0;
  color: #7dd3fc;
  font-size: 11px;
}

.canvas-node__error {
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.12);
  padding: 8px 9px;
  color: #fca5a5;
  font-size: 11px;
  line-height: 1.45;
}

.canvas-node__result {
  overflow: hidden;
  border-radius: 9px;
  background: #050810;
}

.canvas-node__result img,
.canvas-node__result video {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
}

.canvas-node__generate {
  border: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, #f97316, #fb923c);
  padding: 9px 12px;
  color: #111827;
  font-size: 12px;
  font-weight: 700;
}

.canvas-node__generate:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.canvas-handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid #0f172a !important;
  background: #fb923c !important;
}

.canvas-handle--target { background: #38bdf8 !important; }

@media (max-width: 640px) {
  .canvas-node {
    width: 290px;
  }
}
</style>
