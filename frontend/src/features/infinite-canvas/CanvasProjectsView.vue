<template>
  <AppLayout>
    <div class="mx-auto w-full max-w-6xl py-2">
      <header class="mb-8 flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-dark-700">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary-500">CANVAS</p>
          <h1 class="mt-2 text-3xl font-bold text-gray-950 dark:text-white">无限画布</h1>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            在自由画布上组合图片、视频和提示词节点，直接使用现有模型生成内容。
          </p>
        </div>
        <button type="button" class="btn btn-primary" :disabled="creating" @click="createProject">
          <Icon name="plus" size="sm" class="mr-2" />
          {{ creating ? '创建中...' : '新建画布' }}
        </button>
      </header>

      <div v-if="loading" class="flex min-h-[320px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        正在加载画布...
      </div>

      <div v-else-if="projects.length" class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="project in projects"
          :key="project.id"
          class="group relative overflow-hidden rounded-xl border border-gray-200 bg-white transition-colors hover:border-primary-300 dark:border-dark-700 dark:bg-dark-900 dark:hover:border-primary-700"
        >
          <button
            type="button"
            class="block w-full p-5 text-left"
            @click="router.push(`/canvas/${project.id}`)"
          >
            <div class="mb-10 flex items-start justify-between">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">
                <Icon name="grid" size="md" />
              </div>
              <span class="rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-500 dark:bg-dark-800 dark:text-gray-400">
                v{{ project.version }}
              </span>
            </div>
            <h2 class="truncate text-base font-semibold text-gray-950 dark:text-white">{{ project.title }}</h2>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              更新于 {{ formatDate(project.updated_at) }}
            </p>
          </button>
          <button
            type="button"
            class="absolute right-4 top-4 rounded-md p-1.5 text-gray-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10"
            title="删除画布"
            @click.stop="removeProject(project)"
          >
            <Icon name="trash" size="sm" />
          </button>
        </article>
      </div>

      <section
        v-else
        class="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 text-center dark:border-dark-700 dark:bg-dark-900/60"
      >
        <div class="flex h-14 w-14 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">
          <Icon name="grid" size="lg" />
        </div>
        <h2 class="mt-5 text-lg font-semibold text-gray-950 dark:text-white">还没有画布</h2>
        <p class="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
          创建第一个无限画布，把提示词、图片和视频生成节点连接起来。
        </p>
        <button type="button" class="btn btn-primary mt-6" @click="createProject">新建画布</button>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import canvasProjectAPI from '@/api/canvas'
import { useAppStore } from '@/stores/app'
import type { CanvasProjectSummary } from '@/types/canvas'

const router = useRouter()
const appStore = useAppStore()
const projects = ref<CanvasProjectSummary[]>([])
const loading = ref(true)
const creating = ref(false)

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

async function loadProjects() {
  loading.value = true
  try {
    projects.value = await canvasProjectAPI.list()
  } catch (error) {
    appStore.showError(error instanceof Error ? error.message : '加载画布失败')
  } finally {
    loading.value = false
  }
}

async function createProject() {
  if (creating.value) return
  creating.value = true
  try {
    const project = await canvasProjectAPI.create({
      title: `未命名画布 ${projects.value.length + 1}`,
    })
    await router.push(`/canvas/${project.id}`)
  } catch (error) {
    appStore.showError(error instanceof Error ? error.message : '创建画布失败')
  } finally {
    creating.value = false
  }
}

async function removeProject(project: CanvasProjectSummary) {
  if (!window.confirm(`确定删除“${project.title}”？删除后无法恢复。`)) return
  try {
    await canvasProjectAPI.delete(project.id)
    projects.value = projects.value.filter((item) => item.id !== project.id)
    appStore.showSuccess('画布已删除')
  } catch (error) {
    appStore.showError(error instanceof Error ? error.message : '删除画布失败')
  }
}

onMounted(loadProjects)
</script>
