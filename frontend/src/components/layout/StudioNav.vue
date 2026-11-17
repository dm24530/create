<template>
  <nav class="studio-nav" :class="{ 'studio-nav--inline': inline }" aria-label="创作工作台">
    <div class="studio-nav__inner" :class="{ 'studio-nav__inner--inline': inline }">
      <RouterLink to="/image-studio" class="studio-nav__item" active-class="studio-nav__item--active" data-tour="nav-image-studio">
        <Icon name="grid" size="sm" />
        <span>生图工作台</span>
      </RouterLink>
      <RouterLink to="/video-studio" class="studio-nav__item" active-class="studio-nav__item--active" data-tour="nav-video-studio">
        <Icon name="play" size="sm" />
        <span>视频工作台</span>
      </RouterLink>
      <RouterLink v-if="showCanvas" to="/canvas" class="studio-nav__item" active-class="studio-nav__item--active" data-tour="nav-canvas">
        <Icon name="frame" size="sm" />
        <span>Create</span>
      </RouterLink>
      <RouterLink to="/image-inspiration" class="studio-nav__item" active-class="studio-nav__item--active" data-tour="nav-image-inspiration">
        <Icon name="lightbulb" size="sm" />
        <span>图片灵感</span>
      </RouterLink>
      <RouterLink to="/video-inspiration" class="studio-nav__item" active-class="studio-nav__item--active" data-tour="nav-video-inspiration">
        <Icon name="lightbulb" size="sm" />
        <span>视频灵感</span>
      </RouterLink>
      <RouterLink to="/video-works" class="studio-nav__item" active-class="studio-nav__item--active" data-tour="nav-video-works">
        <Icon name="bookmark" size="sm" />
        <span>我的作品</span>
      </RouterLink>
    </div>
    <div v-if="!inline" class="studio-nav__actions">
      <slot name="actions" />
    </div>
  </nav>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'
import { computed } from 'vue'
import { useAuthStore } from '@/stores'
import { FeatureFlags, isFeatureFlagEnabled } from '@/utils/featureFlags'

withDefaults(defineProps<{
  inline?: boolean
}>(), {
  inline: false,
})

const authStore = useAuthStore()
const showCanvas = computed(() => (
  authStore.isAdmin || !isFeatureFlagEnabled(FeatureFlags.canvasAdminOnly)
))
</script>

<style scoped>
.studio-nav {
  position: relative;
  display: flex;
  height: 3.5rem;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgb(229 231 235);
  background: rgb(255 255 255);
}

.studio-nav--inline {
  height: 2.75rem;
  border-bottom: 0;
  background: transparent;
  justify-content: flex-start;
}

.studio-nav__inner--inline {
  justify-content: flex-start;
  gap: 0.1rem;
  overflow: visible;
  padding: 0;
}

.studio-nav--inline .studio-nav__item {
  height: 2.25rem;
  padding: 0 0.6rem;
  font-size: 0.78rem;
}

.studio-nav--inline .studio-nav__item--active::after {
  right: 0.6rem;
  bottom: 0.15rem;
  left: 0.6rem;
}

.studio-nav__actions {
  position: absolute;
  top: 50%;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transform: translateY(-50%);
}

.studio-nav__inner {
  display: flex;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0 1rem;
}

.studio-nav__item {
  position: relative;
  display: inline-flex;
  height: 3.5rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.85rem;
  color: rgb(107 114 128);
  font-size: 0.82rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.16s ease;
}

.studio-nav__item:hover {
  color: rgb(24 24 27);
}

.studio-nav__item--active {
  color: rgb(24 24 27);
}

.studio-nav__item--active::after {
  position: absolute;
  right: 0.85rem;
  bottom: 0;
  left: 0.85rem;
  height: 2px;
  background: rgb(24 24 27);
  content: '';
}

@media (max-width: 767px) {
  .studio-nav {
    justify-content: flex-start;
  }

  .studio-nav__inner {
    width: 100%;
    justify-content: flex-start;
  }

  .studio-nav__actions {
    position: static;
    margin-left: auto;
    padding-right: 0.5rem;
    transform: none;
  }

}

:global(.dark .studio-nav) {
  border-color: rgb(63 63 70);
  background: rgb(18 18 20);
}

:global(.dark .studio-nav__item) {
  color: rgb(161 161 170);
}

:global(.dark .studio-nav__item:hover),
:global(.dark .studio-nav__item--active) {
  color: rgb(244 244 245);
}

:global(.dark .studio-nav__item--active::after) {
  background: rgb(244 244 245);
}


:global(.dark .studio-nav--inline) {
  border-bottom: 0;
  background: transparent;
}
</style>
