<template>
  <article class="inspiration-tile" :data-testid="testId">
    <button
      type="button"
      class="inspiration-tile__trigger"
      :aria-label="actionLabel"
      @click="$emit('open')"
    >
      <span class="inspiration-tile__media" :style="mediaStyle">
        <img
          v-if="imageUrl"
          :src="imageUrl"
          alt=""
          loading="lazy"
          class="inspiration-tile__image"
          @error="$emit('imageError')"
        />
        <span class="inspiration-tile__shade" aria-hidden="true" />
        <span v-if="badge" class="inspiration-tile__badge">{{ badge }}</span>
        <span v-if="spec" class="inspiration-tile__spec">{{ spec }}</span>
        <span v-if="typeIcon" class="inspiration-tile__type" aria-hidden="true">
          <Icon :name="typeIcon" size="sm" />
        </span>
        <span class="inspiration-tile__caption">
          <span class="inspiration-tile__eyebrow">{{ eyebrow }}</span>
          <strong class="inspiration-tile__title">{{ title }}</strong>
          <span v-if="summary" class="inspiration-tile__summary">{{ summary }}</span>
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
  typeIcon?: 'play' | 'grid'
  actionLabel: string
}>()

defineEmits<{
  open: []
  imageError: []
}>()
</script>

<style scoped>
.inspiration-tile {
  display: block;
  width: 100%;
  margin: 0 0 1rem;
  break-inside: avoid;
}

.inspiration-tile__trigger {
  display: block;
  width: 100%;
  border-radius: 0.875rem;
  background: rgb(17 17 17);
  text-align: left;
  cursor: zoom-in;
}

.inspiration-tile__trigger:focus-visible {
  outline: 2px solid rgb(232 121 78);
  outline-offset: 3px;
}

.inspiration-tile__media {
  position: relative;
  display: block;
  min-height: 11rem;
  max-height: 27rem;
  width: 100%;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.875rem;
  background: rgb(21 20 18);
  isolation: isolate;
}

.inspiration-tile__image {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  object-fit: cover;
  transition: transform 260ms ease, opacity 260ms ease;
}

.inspiration-tile__trigger:hover .inspiration-tile__image {
  transform: scale(1.025);
}

.inspiration-tile__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgb(8 8 8 / 0.88) 0%,
    rgb(8 8 8 / 0.4) 32%,
    rgb(8 8 8 / 0.02) 62%
  );
}

.inspiration-tile__badge,
.inspiration-tile__spec,
.inspiration-tile__type {
  position: absolute;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  background: rgb(12 12 12 / 0.62);
  color: rgb(245 245 245);
  backdrop-filter: blur(8px);
}

.inspiration-tile__badge {
  top: 0.7rem;
  left: 0.7rem;
  padding: 0.22rem 0.55rem;
  font-size: 0.68rem;
}

.inspiration-tile__spec {
  top: 0.7rem;
  right: 0.7rem;
  padding: 0.22rem 0.55rem;
  font-size: 0.68rem;
}

.inspiration-tile__type {
  right: 0.7rem;
  bottom: 0.75rem;
  height: 2rem;
  width: 2rem;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.12);
}

.inspiration-tile__caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  padding: 4.5rem 1rem 0.95rem;
  color: rgb(255 255 255);
}

.inspiration-tile__eyebrow {
  font-size: 0.68rem;
  font-weight: 500;
  color: rgb(245 161 127);
}

.inspiration-tile__title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.98rem;
  font-weight: 650;
  line-height: 1.35;
}

.inspiration-tile__summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  padding-right: 2.5rem;
  font-size: 0.75rem;
  color: rgb(226 232 240 / 0.86);
}

@media (max-width: 639px) {
  .inspiration-tile__media {
    max-height: 22rem;
  }
}

:global(.dark .inspiration-tile__media) {
  border-color: rgb(66 61 55);
}
</style>
