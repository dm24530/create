<template>
  <article class="image-inspiration-tile" :data-testid="testId">
    <button
      type="button"
      class="image-inspiration-tile__trigger"
      :aria-label="actionLabel"
      @click="$emit('open')"
    >
      <span class="image-inspiration-tile__media" :style="mediaStyle">
        <img
          v-if="imageUrl"
          :src="imageUrl"
          alt=""
          loading="lazy"
          decoding="async"
          class="image-inspiration-tile__image"
          @error="$emit('imageError')"
        />
        <span class="image-inspiration-tile__shade" aria-hidden="true" />
        <span v-if="badge" class="image-inspiration-tile__badge">{{ badge }}</span>
        <span v-if="spec" class="image-inspiration-tile__spec">{{ spec }}</span>
        <span class="image-inspiration-tile__caption">
          <span class="image-inspiration-tile__eyebrow">{{ eyebrow }}</span>
          <strong class="image-inspiration-tile__title">{{ title }}</strong>
          <span v-if="summary" class="image-inspiration-tile__summary">{{ summary }}</span>
        </span>
        <span class="image-inspiration-tile__action" aria-hidden="true">
          <Icon name="arrowRight" size="sm" />
        </span>
      </span>
    </button>
  </article>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'

defineProps<{
  testId: string
  imageUrl: string
  mediaStyle: Record<string, string>
  title: string
  eyebrow: string
  summary?: string
  spec?: string
  badge?: string
  actionLabel: string
}>()

defineEmits<{
  open: []
  imageError: []
}>()
</script>

<style scoped>
.image-inspiration-tile {
  display: block;
  width: 100%;
  margin: 0 0 1rem;
  break-inside: avoid;
}

.image-inspiration-tile__trigger {
  display: block;
  width: 100%;
  border-radius: 0.75rem;
  background: rgb(17 17 17);
  text-align: left;
  cursor: zoom-in;
}

.image-inspiration-tile__trigger:focus-visible {
  outline: 2px solid rgb(232 121 78);
  outline-offset: 3px;
}

.image-inspiration-tile__media {
  position: relative;
  display: block;
  min-height: 12rem;
  max-height: 32rem;
  width: 100%;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  background: rgb(21 20 18);
  isolation: isolate;
}

.image-inspiration-tile__image {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  object-fit: cover;
  transition: transform 260ms ease, opacity 260ms ease;
}

.image-inspiration-tile__trigger:hover .image-inspiration-tile__image {
  transform: scale(1.025);
}

.image-inspiration-tile__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgb(8 8 8 / 0.9) 0%,
    rgb(8 8 8 / 0.42) 34%,
    rgb(8 8 8 / 0.02) 64%
  );
}

.image-inspiration-tile__badge,
.image-inspiration-tile__spec {
  position: absolute;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  background: rgb(12 12 12 / 0.62);
  padding: 0.22rem 0.55rem;
  font-size: 0.68rem;
  color: rgb(245 245 245);
  backdrop-filter: blur(8px);
}

.image-inspiration-tile__badge {
  top: 0.7rem;
  left: 0.7rem;
}

.image-inspiration-tile__spec {
  top: 0.7rem;
  right: 0.7rem;
}

.image-inspiration-tile__caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  padding: 4.2rem 3.6rem 0.95rem 1rem;
  color: rgb(255 255 255);
}

.image-inspiration-tile__eyebrow {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  font-weight: 500;
  color: rgb(245 161 127);
}

.image-inspiration-tile__title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.98rem;
  font-weight: 650;
  line-height: 1.35;
}

.image-inspiration-tile__summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  font-size: 0.75rem;
  color: rgb(226 232 240 / 0.86);
}

.image-inspiration-tile__action {
  position: absolute;
  right: 0.8rem;
  bottom: 0.85rem;
  z-index: 1;
  display: inline-flex;
  height: 2rem;
  width: 2rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 9999px;
  background: rgb(12 12 12 / 0.5);
  color: rgb(245 245 245);
  backdrop-filter: blur(8px);
  transition: background 180ms ease, transform 180ms ease;
}

.image-inspiration-tile__trigger:hover .image-inspiration-tile__action {
  transform: translateX(2px);
  background: rgb(232 121 78 / 0.9);
  color: rgb(28 18 13);
}

@media (max-width: 639px) {
  .image-inspiration-tile__media {
    max-height: 24rem;
  }
}

:global(.dark .image-inspiration-tile__media) {
  border-color: rgb(66 61 55);
}
</style>
