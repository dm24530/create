<template>
  <div class="min-h-screen bg-gray-50 dark:bg-dark-950">
    <!-- Background Decoration -->
    <div v-if="!isImmersive" class="pointer-events-none fixed inset-0 bg-mesh-gradient"></div>

    <!-- Sidebar -->
    <AppSidebar v-if="!isImmersive && !usesHorizontalUserLayout" />

    <!-- Main Content Area -->
    <div
      class="relative min-h-screen transition-all duration-300"
      :class="isImmersive || usesHorizontalUserLayout ? '' : [sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-64']"
    >
      <!-- Header -->
      <AppHeader :compact="isImmersive || usesHorizontalUserLayout">
        <template v-if="showStudioNav" #nav>
          <StudioNav inline />
        </template>
      </AppHeader>

      <UserNav v-if="usesHorizontalUserLayout" />

      <!-- Main Content -->
      <main :class="isImmersive ? 'p-0' : 'p-4 md:p-6 lg:p-8'">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import '@/styles/onboarding.css'
import { computed, onMounted } from 'vue'
import { useAppStore } from '@/stores'
import { useAuthStore } from '@/stores/auth'
import { useOnboardingTour } from '@/composables/useOnboardingTour'
import { useOnboardingStore } from '@/stores/onboarding'
import { useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'
import StudioNav from './StudioNav.vue'
import UserNav from './UserNav.vue'

const appStore = useAppStore()
const authStore = useAuthStore()
const route = useRoute()
const sidebarCollapsed = computed(() => appStore.sidebarCollapsed)
const isAdmin = computed(() => authStore.user?.role === 'admin')
const isImmersive = computed(() => route.meta.immersive === true)
const usesHorizontalUserLayout = computed(() =>
  !isImmersive.value && !route.path.startsWith('/admin'),
)
const studioNavPaths = new Set([
  '/image-studio',
  '/canvas',
  '/video-studio',
  '/image-inspiration',
  '/video-inspiration',
  '/video-works',
])
const showStudioNav = computed(() => studioNavPaths.has(route.path))

const { replayTour } = useOnboardingTour({
  storageKey: isAdmin.value ? 'admin_guide' : 'user_guide',
  autoStart: false
})

const onboardingStore = useOnboardingStore()

onMounted(() => {
  onboardingStore.setReplayCallback(replayTour)
})

defineExpose({ replayTour })
</script>
