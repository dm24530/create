<template>
  <figure class="doc-code">
    <figcaption class="doc-code__head">
      <span>{{ title || language }}</span>
      <button type="button" class="doc-code__copy" @click="copyCode">
        <Icon :name="copied ? 'check' : 'copy'" size="xs" />
        <span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
    </figcaption>
    <pre class="doc-code__body"><code>{{ code }}</code></pre>
  </figure>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import Icon from '@/components/icons/Icon.vue'
import { useClipboard } from '@/composables/useClipboard'

const props = withDefaults(defineProps<{
  code: string
  language?: string
  title?: string
}>(), {
  language: 'text',
  title: '',
})

const { copyToClipboard } = useClipboard()
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

async function copyCode() {
  const ok = await copyToClipboard(props.code, '代码已复制')
  if (!ok) return
  copied.value = true
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = false
    resetTimer = null
  }, 1600)
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<style scoped>
.doc-code {
  overflow: hidden;
  border: 1px solid rgb(30 41 59);
  border-radius: 0.65rem;
  background: rgb(15 23 42);
}

.doc-code__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid rgb(51 65 85);
  padding: 0.45rem 0.75rem;
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.doc-code__copy {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.35rem;
  padding: 0.2rem 0.45rem;
  color: rgb(203 213 225);
}

.doc-code__copy:hover {
  background: rgb(51 65 85 / 0.7);
  color: rgb(255 255 255);
}

.doc-code__body {
  overflow-x: auto;
  padding: 0.9rem 1rem;
  font-size: 0.78rem;
  line-height: 1.7;
  color: rgb(226 232 240);
  tab-size: 2;
}

.doc-code__body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
</style>
