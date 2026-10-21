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
  border: 1px solid rgb(226 232 240);
  border-radius: 0.65rem;
  background: transparent;
}

.doc-code__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid rgb(226 232 240);
  padding: 0.45rem 0.75rem;
  font-size: 0.7rem;
  color: rgb(100 116 139);
}

.doc-code__copy {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.35rem;
  padding: 0.2rem 0.45rem;
  color: rgb(71 85 105);
}

.doc-code__copy:hover {
  background: rgb(241 245 249);
  color: rgb(15 23 42);
}

.doc-code__body {
  overflow-x: auto;
  padding: 0.9rem 1rem;
  font-size: 0.78rem;
  line-height: 1.7;
  color: rgb(30 41 59);
  tab-size: 2;
}

.doc-code .doc-code__body code {
  background: transparent;
  border-radius: 0;
  padding: 0;
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

:global(.dark .doc-code) {
  border-color: rgb(82 82 91);
}

:global(.dark .doc-code__head) {
  border-color: rgb(63 63 70);
  color: rgb(167 159 148);
}

:global(.dark .doc-code__copy) {
  color: rgb(201 193 182);
}

:global(.dark .doc-code__copy:hover) {
  background: rgb(39 39 42 / 0.8);
  color: rgb(250 250 250);
}

:global(.dark .doc-code__body) {
  color: rgb(227 219 208);
}
</style>
