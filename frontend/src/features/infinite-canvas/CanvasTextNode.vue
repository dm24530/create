<template>
  <div class="canvas-text-node" :class="{ 'canvas-text-node--selected': selected }">
    <Handle type="source" :position="Position.Right" class="canvas-text-handle" />
    <header>
      <span>TEXT</span>
      <button type="button" class="nodrag" title="删除节点" @click.stop="store.removeNode(id)">×</button>
    </header>
    <textarea
      v-model="text"
      class="nodrag nowheel"
      placeholder="输入提示词、说明或创作上下文"
      @input="update"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasWorkspaceStore } from './canvasWorkspaceStore'
import type { CanvasNodeData } from '@/types/canvas'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const store = useCanvasWorkspaceStore()
const text = ref(props.data.prompt)

watch(
  () => props.data.prompt,
  (value) => {
    text.value = value
  },
)

function update() {
  store.updateNodeData(props.id, {
    prompt: text.value,
    label: text.value.trim().slice(0, 24) || '文本',
  })
}
</script>

<style scoped>
.canvas-text-node {
  width: 280px;
  min-height: 160px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: rgba(245, 239, 224, 0.96);
  color: #292524;
  box-shadow: 0 16px 46px rgba(0, 0, 0, 0.24);
}

.canvas-text-node--selected {
  border-color: #fb923c;
  box-shadow: 0 16px 46px rgba(0, 0, 0, 0.32), 0 0 0 2px rgba(251, 146, 60, 0.24);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 11px 7px;
  color: #a16207;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

header button {
  border: 0;
  background: transparent;
  color: #78716c;
  font-size: 18px;
}

textarea {
  display: block;
  width: 100%;
  min-height: 120px;
  border: 0;
  background: transparent;
  padding: 0 12px 12px;
  color: #292524;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
}

.canvas-text-handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid #f5efe0 !important;
  background: #d97706 !important;
}
</style>
