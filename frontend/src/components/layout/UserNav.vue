<template>
  <nav class="user-nav" aria-label="用户导航" data-tour="user-nav">
    <div class="user-nav__inner">
      <RouterLink to="/image-studio" class="user-nav__item" data-tour="nav-image-studio">
        <Icon name="grid" size="sm" />
        <span>生图工作台</span>
      </RouterLink>
      <RouterLink to="/video-studio" class="user-nav__item" data-tour="nav-video-studio">
        <Icon name="play" size="sm" />
        <span>视频工作台</span>
      </RouterLink>
      <RouterLink to="/canvas" class="user-nav__item" data-tour="nav-canvas">
        <Icon name="grid" size="sm" />
        <span>无限画布</span>
      </RouterLink>
      <RouterLink to="/image-inspiration" class="user-nav__item" data-tour="nav-image-inspiration">
        <Icon name="lightbulb" size="sm" />
        <span>图片灵感</span>
      </RouterLink>
      <RouterLink to="/video-inspiration" class="user-nav__item" data-tour="nav-video-inspiration">
        <Icon name="lightbulb" size="sm" />
        <span>视频灵感</span>
      </RouterLink>
      <RouterLink to="/video-works" class="user-nav__item" data-tour="nav-video-works">
        <Icon name="bookmark" size="sm" />
        <span>我的作品</span>
      </RouterLink>
      <RouterLink to="/docs/api" class="user-nav__item" data-tour="nav-api-docs">
        <Icon name="book" size="sm" />
        <span>接口文档</span>
      </RouterLink>
      <RouterLink
        :to="{ path: '/image-studio', query: { openApiKeys: '1' } }"
        class="user-nav__item"
        data-tour="nav-api-keys"
      >
        <Icon name="key" size="sm" />
        <span>API 密钥</span>
      </RouterLink>
      <RouterLink to="/usage" class="user-nav__item" data-tour="nav-usage">
        <Icon name="chart" size="sm" />
        <span>使用记录</span>
      </RouterLink>
      <RouterLink to="/profile" class="user-nav__item" data-tour="nav-profile">
        <Icon name="user" size="sm" />
        <span>个人中心</span>
      </RouterLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'
</script>

<style scoped>
.user-nav {
  position: sticky;
  top: 3.5rem;
  z-index: 20;
  border-bottom: 1px solid rgb(229 231 235);
  background: rgb(255 255 255 / 0.96);
  backdrop-filter: blur(16px);
}

.user-nav__inner {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.15rem;
  overflow-x: auto;
  padding: 0 1rem;
  scrollbar-width: none;
}

.user-nav__inner::-webkit-scrollbar {
  display: none;
}

.user-nav__item {
  position: relative;
  display: inline-flex;
  height: 3.5rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.8rem;
  color: rgb(107 114 128);
  font-size: 0.8rem;
  font-weight: 500;
  text-decoration: none;
}

.user-nav__item:hover,
.user-nav__item.router-link-active {
  color: rgb(24 24 27);
}

.user-nav__item.router-link-active::after {
  position: absolute;
  right: 0.8rem;
  bottom: 0;
  left: 0.8rem;
  height: 2px;
  background: rgb(24 24 27);
  content: '';
}

:global(.dark .user-nav) {
  border-color: rgb(63 63 70);
  background: rgb(18 18 20 / 0.96);
}

:global(.dark .user-nav__item) {
  color: rgb(161 161 170);
}

:global(.dark .user-nav__item:hover),
:global(.dark .user-nav__item.router-link-active) {
  color: rgb(244 244 245);
}

:global(.dark .user-nav__item.router-link-active::after) {
  background: rgb(244 244 245);
}
</style>
