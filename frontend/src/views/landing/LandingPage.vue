<template>
  <div class="landing-shell">
    <header class="landing-nav">
      <RouterLink to="/home" class="landing-brand" aria-label="Create home">
        <span class="landing-brand-name">{{ siteName }}</span>
      </RouterLink>

      <nav class="landing-desktop-nav" aria-label="Primary">
        <RouterLink to="/image-studio">{{ t('home.landing.nav.image') }}</RouterLink>
        <RouterLink to="/video-studio">{{ t('home.landing.nav.video') }}</RouterLink>
        <RouterLink to="/video-inspiration">{{ t('home.landing.nav.inspiration') }}</RouterLink>
        <RouterLink to="/video-works">{{ t('home.landing.nav.works') }}</RouterLink>
        <RouterLink v-if="showModelPlazaEntry" to="/model-plaza">{{ t('home.landing.nav.models') }}</RouterLink>
        <a v-if="docUrl" :href="docUrl" target="_blank" rel="noopener noreferrer">{{ t('home.landing.nav.docs') }}</a>
      </nav>

      <div class="landing-nav-actions">
        <LocaleSwitcher />
        <RouterLink :to="workspaceTarget" class="landing-workspace">
          {{ isAuthenticated ? t('home.landing.workspace') : t('home.login') }}
          <Icon name="arrowRight" size="sm" />
        </RouterLink>
        <button class="landing-menu-toggle" type="button" :aria-expanded="mobileOpen" @click="mobileOpen = !mobileOpen">
          <Icon :name="mobileOpen ? 'x' : 'menu'" size="md" />
        </button>
      </div>
    </header>

    <nav v-if="mobileOpen" class="landing-mobile-nav" aria-label="Mobile navigation">
      <RouterLink to="/image-studio" @click="mobileOpen = false">{{ t('home.landing.nav.image') }}</RouterLink>
      <RouterLink to="/video-studio" @click="mobileOpen = false">{{ t('home.landing.nav.video') }}</RouterLink>
      <RouterLink to="/video-inspiration" @click="mobileOpen = false">{{ t('home.landing.nav.inspiration') }}</RouterLink>
      <RouterLink to="/video-works" @click="mobileOpen = false">{{ t('home.landing.nav.works') }}</RouterLink>
      <RouterLink v-if="showModelPlazaEntry" to="/model-plaza" @click="mobileOpen = false">{{ t('home.landing.nav.models') }}</RouterLink>
      <a v-if="docUrl" :href="docUrl" target="_blank" rel="noopener noreferrer">{{ t('home.landing.nav.docs') }}</a>
    </nav>

    <main>
      <section
        ref="heroRef"
        class="landing-hero"
        @pointermove="handleHeroPointer"
        @pointerleave="resetHeroPointer"
      >
        <div class="landing-hero-media" :style="heroMediaStyle">
          <template v-for="(slide, index) in heroSlides" :key="slide.id">
            <img
              v-if="heroRequested[index]"
              :src="slide.image"
              :srcset="slide.srcset"
              sizes="100vw"
              class="landing-hero-art"
              :class="{ 'is-active': index === activeHeroSlide }"
              alt=""
              decoding="async"
              loading="eager"
              :fetchpriority="index === 0 ? 'high' : 'low'"
              @load="handleHeroImageLoad(index)"
              @error="handleHeroImageLoad(index)"
            />
          </template>
        </div>
        <div class="landing-hero-light" :style="heroLightStyle" />
        <div class="landing-hero-shade" />
        <div class="landing-hero-content" :style="heroContentStyle">
          <p class="landing-eyebrow"><span class="landing-live-dot" />{{ t('home.landing.eyebrow') }}</p>
          <h1>
            {{ t('home.landing.titleTop') }}<br />
            <span>{{ t('home.landing.titleAccent') }}</span>
          </h1>
          <p class="landing-hero-description">
            {{ t('home.landing.description') }}
          </p>
          <div class="landing-actions">
            <RouterLink :to="imageTarget" class="landing-button landing-button-primary">
              <Icon name="sparkles" size="sm" />
              {{ t('home.landing.startImage') }}
              <Icon name="arrowRight" size="sm" />
            </RouterLink>
            <RouterLink :to="videoTarget" class="landing-button landing-button-glass">
              <Icon name="play" size="sm" />
              {{ t('home.landing.createVideo') }}
              <Icon name="arrowRight" size="sm" />
            </RouterLink>
          </div>
          <div class="landing-hero-models">
            <span>GPT IMAGE</span>
            <span>SEEDANCE</span>
            <span>GROK IMAGINE</span>
          </div>
        </div>
        <div class="landing-hero-bottom">
          <span>{{ t('home.landing.explore') }} ↓</span>
          <div class="landing-hero-controls">
            <button
              v-for="(slide, index) in heroSlides"
              :key="`dot-${slide.id}`"
              type="button"
              class="landing-hero-dot"
              :class="{ 'is-active': index === activeHeroSlide }"
              :aria-label="slide.label"
              :aria-pressed="index === activeHeroSlide"
              @click="selectHeroSlide(index)"
            />
            <span class="landing-hero-count">
              {{ String(activeHeroSlide + 1).padStart(2, '0') }} /
              {{ String(heroSlides.length).padStart(2, '0') }}
            </span>
          </div>
        </div>
      </section>

      <section class="landing-section landing-section-gallery">
        <div class="landing-section-heading">
          <div>
            <p class="landing-eyebrow">01 / BEYOND THE ORDINARY</p>
            <h2>{{ t('home.landing.galleryTitle') }}</h2>
          </div>
          <RouterLink :to="imageTarget" class="landing-text-link">
            {{ t('home.landing.galleryLink') }}
            <Icon name="arrowRight" size="sm" />
          </RouterLink>
        </div>

        <div class="landing-art-rail">
          <RouterLink
            v-for="item in galleryItems"
            :key="item.title"
            :to="item.to"
            class="landing-art-piece"
            :class="item.className"
          >
            <div class="landing-art-image">
              <img :src="item.image" :alt="item.title" loading="lazy" />
              <span class="landing-art-open"><Icon name="arrowRight" size="sm" /></span>
            </div>
            <div class="landing-art-caption">
              <strong>{{ item.title }}</strong>
              <span>{{ item.meta }}</span>
            </div>
          </RouterLink>
        </div>
      </section>

      <section class="landing-motion-section">
        <div class="landing-motion-art">
          <img src="/landing/motion-cinema.jpg" :alt="t('home.landing.filmTitle')" loading="lazy" />
          <span class="landing-image-label">CINEMATIC / 02</span>
          <span class="landing-frame-corner landing-frame-corner-tl" />
          <span class="landing-frame-corner landing-frame-corner-br" />
        </div>
        <div class="landing-motion-copy">
          <p class="landing-eyebrow">02 / FROM FRAME TO FILM</p>
          <h2>
            {{ t('home.landing.filmTitle') }}<br />
            <span>{{ t('home.landing.filmAccent') }}</span>
          </h2>
          <p class="landing-body-copy">{{ t('home.landing.filmDescription') }}</p>
          <ul class="landing-feature-lines">
            <li v-for="point in filmPoints" :key="point"><span>+</span>{{ point }}</li>
          </ul>
          <RouterLink :to="videoTarget" class="landing-button landing-button-light">
            {{ t('home.landing.filmCta') }}
            <Icon name="arrowRight" size="sm" />
          </RouterLink>
        </div>
      </section>

      <section class="landing-section landing-notebook">
        <div class="landing-section-heading">
          <div>
            <p class="landing-eyebrow">03 / THE DIRECTOR'S NOTEBOOK</p>
            <h2>{{ t('home.landing.notebookTitle') }}</h2>
          </div>
          <RouterLink to="/video-inspiration" class="landing-text-link">
            {{ t('home.landing.notebookLink') }}
            <Icon name="arrowRight" size="sm" />
          </RouterLink>
        </div>
        <p class="landing-section-intro">{{ t('home.landing.notebookDescription') }}</p>

        <div class="landing-recipe-list">
          <RouterLink
            v-for="(item, index) in recipeItems"
            :key="item.title"
            :to="item.to"
            class="landing-recipe-row"
          >
            <span class="landing-recipe-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="landing-recipe-thumb">
              <img :src="item.image" :alt="item.title" loading="lazy" />
            </span>
            <span class="landing-recipe-copy">
              <strong>{{ item.title }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <span class="landing-recipe-spec">{{ item.spec }}</span>
            <Icon name="arrowRight" size="sm" />
          </RouterLink>
        </div>
      </section>

      <section class="landing-section landing-principles">
        <div class="landing-principles-title">
          <p class="landing-eyebrow">04 / BUILT FOR CREATORS</p>
          <h2>{{ t('home.landing.principlesTitle') }}</h2>
        </div>
        <div class="landing-principles-list">
          <article v-for="(item, index) in principles" :key="item.title">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
            </div>
          </article>
        </div>
      </section>

      <section class="landing-final-cta">
        <p class="landing-eyebrow">05 / MAKE SOMETHING REAL</p>
        <h2>{{ t('home.landing.ctaTitle') }}</h2>
        <p>{{ t('home.landing.ctaDescription') }}</p>
        <RouterLink :to="imageTarget" class="landing-button landing-button-primary">
          {{ isAuthenticated ? t('home.landing.goWorkspace') : t('home.landing.ctaButton') }}
          <Icon name="arrowRight" size="sm" />
        </RouterLink>
      </section>
    </main>

    <footer class="landing-footer">
      <RouterLink to="/home" class="landing-footer-brand">
        <span>{{ siteName }}</span>
      </RouterLink>
      <p>&copy; {{ currentYear }} {{ siteName }}. {{ t('home.footer.allRightsReserved') }}</p>
      <div>
        <a v-if="docUrl" :href="docUrl" target="_blank" rel="noopener noreferrer">{{ t('home.docs') }}</a>
        <RouterLink v-if="showModelPlazaEntry" to="/model-plaza">{{ t('home.landing.nav.models') }}</RouterLink>
        <span>POWERED BY CREATE</span>
        <span>IMAGERY NASA / UNSPLASH</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/common/LocaleSwitcher.vue'
import Icon from '@/components/icons/Icon.vue'

const props = defineProps<{
  siteName: string
  siteSubtitle: string
  docUrl: string
  isAuthenticated: boolean
  dashboardPath: string
  showModelPlazaEntry: boolean
}>()

const { t } = useI18n()
const mobileOpen = ref(false)

const HERO_ROTATION_MS = 6500
const heroRef = ref<HTMLElement | null>(null)
const activeHeroSlide = ref(0)
const heroPointer = ref({ x: 0.5, y: 0.5, active: false })
const reducedMotion = ref(false)
const heroRequested = ref([true, false, false])

function heroSrcset(name: string): string {
  return [640, 960, 1280, 1920, 2560]
    .map((width) => `/landing/${name}-${width}.webp ${width}w`)
    .join(', ')
}

const heroSlides = computed(() => [
  {
    id: 'stars',
    image: '/landing/hero-stars-1280.webp',
    srcset: heroSrcset('hero-stars'),
    label: t('home.landing.slides.stars'),
  },
  {
    id: 'nebula',
    image: '/landing/hero-nebula-1280.webp',
    srcset: heroSrcset('hero-nebula'),
    label: t('home.landing.slides.nebula'),
  },
  {
    id: 'desert',
    image: '/landing/hero-desert-1280.webp',
    srcset: heroSrcset('hero-desert'),
    label: t('home.landing.slides.desert'),
  },
])

const heroMediaStyle = computed(() => ({
  transform: `translate3d(${(0.5 - heroPointer.value.x) * 18}px, ${(0.5 - heroPointer.value.y) * 12}px, 0) scale(1.04)`,
}))

const heroContentStyle = computed(() => ({
  transform: `translate3d(${(heroPointer.value.x - 0.5) * 7}px, ${(heroPointer.value.y - 0.5) * 4}px, 0)`,
}))

const heroLightStyle = computed(() => ({
  opacity: heroPointer.value.active ? '1' : '0.55',
  background: `radial-gradient(520px circle at ${heroPointer.value.x * 100}% ${heroPointer.value.y * 100}%, rgba(232, 121, 78, 0.18), transparent 62%)`,
}))

let heroRotationTimer: ReturnType<typeof setInterval> | null = null
let heroPrefetchTimer: ReturnType<typeof setTimeout> | null = null
let heroPointerFrame = 0
let motionQuery: MediaQueryList | null = null

function stopHeroRotation() {
  if (!heroRotationTimer) return
  clearInterval(heroRotationTimer)
  heroRotationTimer = null
}

function startHeroRotation() {
  stopHeroRotation()
  if (reducedMotion.value || heroSlides.value.length < 2) return
  heroRotationTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    activeHeroSlide.value = (activeHeroSlide.value + 1) % heroSlides.value.length
  }, HERO_ROTATION_MS)
}

function requestHeroSlide(index: number) {
  if (index < 0 || index >= heroRequested.value.length || heroRequested.value[index]) return
  const next = [...heroRequested.value]
  next[index] = true
  heroRequested.value = next
}

function handleHeroImageLoad(index: number) {
  if (index === 0) startHeroRotation()
  if (heroPrefetchTimer) clearTimeout(heroPrefetchTimer)
  const nextIndex = index + 1
  if (nextIndex >= heroSlides.value.length) return
  heroPrefetchTimer = setTimeout(() => requestHeroSlide(nextIndex), 700)
}

function selectHeroSlide(index: number) {
  requestHeroSlide(index)
  activeHeroSlide.value = index
  startHeroRotation()
}

function handleHeroPointer(event: PointerEvent) {
  if (reducedMotion.value || !heroRef.value || heroPointerFrame) return
  const clientX = event.clientX
  const clientY = event.clientY
  heroPointerFrame = requestAnimationFrame(() => {
    heroPointerFrame = 0
    const rect = heroRef.value?.getBoundingClientRect()
    if (!rect) return
    heroPointer.value = {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      active: true,
    }
  })
}

function resetHeroPointer() {
  heroPointer.value = { x: 0.5, y: 0.5, active: false }
}

function handleMotionPreferenceChange(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
  if (event.matches) resetHeroPointer()
  startHeroRotation()
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener?.('change', handleMotionPreferenceChange)
})

onBeforeUnmount(() => {
  stopHeroRotation()
  if (heroPrefetchTimer) clearTimeout(heroPrefetchTimer)
  motionQuery?.removeEventListener?.('change', handleMotionPreferenceChange)
  if (heroPointerFrame) cancelAnimationFrame(heroPointerFrame)
})

const currentYear = computed(() => new Date().getFullYear())
const imageTarget = computed(() => (props.isAuthenticated ? '/image-studio' : '/login'))
const videoTarget = computed(() => (props.isAuthenticated ? '/video-studio' : '/login'))
const workspaceTarget = computed(() => (props.isAuthenticated ? props.dashboardPath : '/login'))

const galleryItems = computed(() => [
  {
    title: t('home.landing.gallery.items.flower'),
    meta: 'SURREAL / 01',
    image: '/landing/flower.jpg',
    className: 'landing-art-1',
    to: imageTarget.value,
  },
  {
    title: t('home.landing.gallery.items.aurora'),
    meta: 'AURORA / 02',
    image: '/landing/gallery-aurora.jpg',
    className: 'landing-art-2',
    to: videoTarget.value,
  },
  {
    title: t('home.landing.gallery.items.nature'),
    meta: 'NATURE / 03',
    image: '/landing/nature.jpg',
    className: 'landing-art-3',
    to: imageTarget.value,
  },
  {
    title: t('home.landing.gallery.items.architecture'),
    meta: 'ARCHITECTURE / 04',
    image: '/landing/architecture.jpg',
    className: 'landing-art-4',
    to: imageTarget.value,
  },
  {
    title: t('home.landing.gallery.items.city'),
    meta: 'NEON / 05',
    image: '/landing/gallery-city.jpg',
    className: 'landing-art-5',
    to: videoTarget.value,
  },
])

const filmPoints = computed(() => [
  t('home.landing.filmPoints.text'),
  t('home.landing.filmPoints.frame'),
  t('home.landing.filmPoints.multimodal'),
])

const recipeItems = computed(() => [
  {
    title: t('home.landing.notebook.items.product.title'),
    meta: t('home.landing.notebook.items.product.meta'),
    spec: '05s / 16:9',
    image: '/landing/recipe-still-life.jpg',
    to: videoTarget.value,
  },
  {
    title: t('home.landing.notebook.items.facade.title'),
    meta: t('home.landing.notebook.items.facade.meta'),
    spec: '06s / 21:9',
    image: '/landing/recipe-facade.jpg',
    to: videoTarget.value,
  },
  {
    title: t('home.landing.notebook.items.botanical.title'),
    meta: t('home.landing.notebook.items.botanical.meta'),
    spec: '04s / 9:16',
    image: '/landing/recipe-botanical.jpg',
    to: videoTarget.value,
  },
])

const principles = computed(() => [
  {
    title: t('home.landing.principles.one.title'),
    description: t('home.landing.principles.one.description'),
  },
  {
    title: t('home.landing.principles.two.title'),
    description: t('home.landing.principles.two.description'),
  },
  {
    title: t('home.landing.principles.three.title'),
    description: t('home.landing.principles.three.description'),
  },
])
</script>

<style scoped>
.landing-shell {
  --landing-bg: #1d1c19;
  --landing-bg-deep: #141312;
  --landing-panel: #23211e;
  --landing-panel-soft: #292723;
  --landing-line: rgba(238, 229, 216, 0.15);
  --landing-muted: #aaa39a;
  --landing-text: #f2ede5;
  --landing-text-soft: #d8d1c7;
  --landing-accent: #e8794e;
  --landing-accent-soft: #f09873;
  min-height: 100vh;
  overflow: clip;
  background: var(--landing-bg);
  color: var(--landing-text);
  font-family: Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.landing-shell *,
.landing-shell *::before,
.landing-shell *::after {
  box-sizing: border-box;
}

.landing-shell a {
  color: inherit;
  text-decoration: none;
}

.landing-shell ::selection {
  color: var(--landing-bg-deep);
  background: var(--landing-accent);
}

.landing-nav {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 86px;
  padding: 0 4.5%;
  border-bottom: 1px solid rgba(238, 229, 216, 0.1);
  background: rgba(29, 28, 25, 0.9);
  backdrop-filter: blur(18px);
}

.landing-brand {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--landing-text);
  font-size: 21px;
  font-weight: 650;
  letter-spacing: 0;
}

.landing-brand-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.landing-desktop-nav {
  display: flex;
  align-items: center;
  gap: 30px;
  color: var(--landing-text-soft);
  font-size: 13px;
}

.landing-desktop-nav a {
  transition: color 0.2s ease;
}

.landing-desktop-nav a:hover {
  color: var(--landing-text);
}

.landing-nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.landing-workspace {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  padding: 0 15px;
  border-radius: 7px;
  background: var(--landing-accent);
  color: #1c120d !important;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  transition: background 0.2s ease;
}

.landing-workspace:hover {
  background: var(--landing-accent-soft);
}

.landing-menu-toggle {
  display: none;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--landing-line);
  border-radius: 7px;
  background: transparent;
  color: var(--landing-text);
}

.landing-mobile-nav {
  display: grid;
  gap: 18px;
  padding: 20px 6%;
  border-bottom: 1px solid var(--landing-line);
  background: var(--landing-panel);
  font-size: 14px;
}

.landing-hero {
  position: relative;
  display: flex;
  align-items: center;
  height: min(800px, calc(100svh - 86px));
  min-height: 680px;
  overflow: hidden;
  isolation: isolate;
  background: var(--landing-bg-deep);
}

.landing-hero-media {
  position: absolute;
  inset: -2%;
  z-index: -4;
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.landing-hero-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 52%;
  opacity: 0;
  filter: sepia(0.1) saturate(0.92) contrast(1.03) brightness(0.96);
  transform: scale(1.02);
  transition:
    opacity 1.15s ease,
    transform 7s cubic-bezier(0.2, 0.65, 0.3, 1);
  will-change: opacity, transform;
}

.landing-hero-art.is-active {
  opacity: 1;
  transform: scale(1.075);
}

.landing-hero-light {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  transition: opacity 0.4s ease;
}

.landing-hero-shade {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(circle at 76% 42%, rgba(232, 121, 78, 0.12), transparent 36%),
    linear-gradient(90deg, rgba(29, 28, 25, 0.92) 0%, rgba(29, 28, 25, 0.72) 34%, rgba(29, 28, 25, 0.18) 66%, transparent 100%),
    linear-gradient(0deg, var(--landing-bg) 0%, rgba(29, 28, 25, 0.44) 22%, transparent 44%);
}

.landing-hero-content {
  width: 100%;
  padding: 30px 4.5% 90px;
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.landing-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 24px;
  color: var(--landing-text-soft);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.landing-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--landing-accent);
}

.landing-hero h1 {
  max-width: 820px;
  margin: 0 0 28px;
  color: var(--landing-text);
  font-size: clamp(54px, 6.1vw, 94px);
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.12;
}

.landing-hero h1 span {
  color: var(--landing-accent-soft);
}

.landing-hero-description {
  max-width: 560px;
  margin: 0 0 30px;
  color: var(--landing-text-soft);
  font-size: 16px;
  line-height: 1.85;
}

.landing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.landing-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 50px;
  padding: 0 22px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 14px;
  font-weight: 600;
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.landing-button:hover {
  transform: translateY(-2px);
}

.landing-button-primary {
  background: var(--landing-accent);
  color: #1c120d !important;
}

.landing-button-primary:hover {
  background: var(--landing-accent-soft);
}

.landing-button-glass {
  border-color: rgba(231, 220, 204, 0.3);
  background: rgba(27, 25, 22, 0.64);
  color: var(--landing-text) !important;
  backdrop-filter: blur(12px);
}

.landing-button-light {
  background: #eee8de;
  color: #1b1916 !important;
}

.landing-hero-models {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
  color: var(--landing-muted);
  font-size: 10px;
  letter-spacing: 1.5px;
}

.landing-hero-models span + span::before {
  margin-right: 12px;
  color: #6f6961;
  content: '·';
}

.landing-hero-bottom {
  position: absolute;
  right: 4.5%;
  bottom: 28px;
  left: 4.5%;
  display: flex;
  justify-content: space-between;
  gap: 15px;
  color: #aaa39a;
  font-size: 10px;
  letter-spacing: 1px;
}

.landing-hero-controls {
  display: flex;
  align-items: center;
  gap: 9px;
}

.landing-hero-dot {
  width: 22px;
  height: 2px;
  padding: 0;
  border: 0;
  background: rgba(238, 229, 216, 0.28);
  cursor: pointer;
  transition: width 0.3s ease, background 0.3s ease;
}

.landing-hero-dot:hover {
  background: rgba(238, 229, 216, 0.58);
}

.landing-hero-dot.is-active {
  width: 34px;
  background: var(--landing-accent);
}

.landing-hero-count {
  padding: 8px 11px;
  border: 1px solid rgba(238, 229, 216, 0.18);
  border-radius: 3px;
  background: rgba(29, 28, 25, 0.58);
  backdrop-filter: blur(10px);
}

.landing-section {
  width: min(100%, 1800px);
  margin: 0 auto;
  padding: 96px 4.5%;
}

.landing-section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 30px;
  margin-bottom: 34px;
}

.landing-section h2 {
  margin: 0;
  color: var(--landing-text);
  font-size: clamp(28px, 3.1vw, 46px);
  font-weight: 550;
  letter-spacing: 0;
  line-height: 1.28;
}

.landing-text-link {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 6px 0;
  color: var(--landing-text-soft);
  font-size: 13px;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.landing-text-link:hover {
  color: var(--landing-accent);
}

.landing-art-rail {
  display: grid;
  grid-template-columns: 1fr 1.26fr 0.93fr 1.26fr 1fr;
  align-items: start;
  gap: 18px;
}

.landing-art-piece {
  display: block;
  min-width: 0;
}

.landing-art-1,
.landing-art-3 {
  padding-top: 60px;
}

.landing-art-4 {
  padding-top: 25px;
}

.landing-art-image {
  position: relative;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  border-radius: 5px;
  background: var(--landing-panel);
  transition: box-shadow 0.35s ease;
}

.landing-art-1 .landing-art-image,
.landing-art-3 .landing-art-image {
  aspect-ratio: 1 / 1.08;
}

.landing-art-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.84) contrast(1.04) brightness(0.96);
  transition: transform 0.65s cubic-bezier(0.2, 0.65, 0.3, 1), filter 0.3s ease;
}

.landing-art-piece:hover .landing-art-image img {
  filter: saturate(1.05) contrast(1.08);
  transform: scale(1.05);
}

.landing-art-piece:hover .landing-art-image {
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.32);
}

.landing-art-image::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 52%, rgba(20, 19, 18, 0.38));
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.landing-art-piece:hover .landing-art-image::after {
  opacity: 1;
}

.landing-art-open {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 50%;
  background: rgba(241, 235, 225, 0.9);
  color: #1b1916;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.landing-art-piece:hover .landing-art-open {
  opacity: 1;
}

.landing-art-caption {
  display: grid;
  gap: 7px;
  padding-top: 12px;
}

.landing-art-caption strong {
  color: var(--landing-text);
  font-size: 13px;
  font-weight: 500;
  transition: color 0.2s ease;
}

.landing-art-piece:hover .landing-art-caption strong {
  color: var(--landing-accent-soft);
}

.landing-art-caption span {
  color: #8f887f;
  font-size: 9px;
  letter-spacing: 1.2px;
}

.landing-motion-section {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
  align-items: center;
  gap: clamp(48px, 6vw, 110px);
  padding: 88px 4.5%;
  border-top: 1px solid var(--landing-line);
  border-bottom: 1px solid var(--landing-line);
  background: var(--landing-panel);
}

.landing-motion-art {
  position: relative;
  width: 100%;
  max-width: 860px;
  max-height: 560px;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  justify-self: end;
  border: 1px solid rgba(238, 229, 216, 0.12);
  border-radius: 6px;
}

.landing-motion-art::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 55%, rgba(35, 33, 30, 0.62));
  content: '';
}

.landing-motion-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: sepia(0.12) saturate(0.94) contrast(1.04) brightness(0.96);
  transition: transform 0.8s cubic-bezier(0.2, 0.65, 0.3, 1);
}

.landing-motion-art:hover img {
  transform: scale(1.035);
}

.landing-image-label {
  position: absolute;
  bottom: 24px;
  left: 24px;
  z-index: 1;
  color: var(--landing-text-soft);
  font-size: 10px;
  letter-spacing: 1.6px;
}

.landing-frame-corner {
  position: absolute;
  z-index: 1;
  width: 24px;
  height: 24px;
  opacity: 0.6;
}

.landing-frame-corner-tl {
  top: 22px;
  left: 22px;
  border-top: 1px solid #fff;
  border-left: 1px solid #fff;
}

.landing-frame-corner-br {
  right: 22px;
  bottom: 22px;
  border-right: 1px solid #fff;
  border-bottom: 1px solid #fff;
}

.landing-motion-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 640px;
  padding: 0;
}

.landing-motion-copy h2 {
  margin-bottom: 24px;
}

.landing-motion-copy h2 span {
  color: #9f9890;
}

.landing-body-copy {
  max-width: 550px;
  margin: 0;
  color: var(--landing-text-soft);
  font-size: 15px;
  line-height: 1.9;
}

.landing-feature-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 15px 25px;
  margin: 30px 0 34px;
  padding: 0;
  color: #c7c0b6;
  font-size: 12px;
  list-style: none;
}

.landing-feature-lines li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.landing-feature-lines span {
  color: var(--landing-accent);
}

.landing-section-intro {
  max-width: 760px;
  margin: -12px 0 34px;
  color: var(--landing-muted);
  font-size: 14px;
  line-height: 1.8;
}

.landing-recipe-list {
  border-top: 1px solid var(--landing-line);
}

.landing-recipe-row {
  display: grid;
  grid-template-columns: 50px 82px minmax(0, 1fr) auto 20px;
  align-items: center;
  gap: 22px;
  padding: 19px 18px;
  border-bottom: 1px solid var(--landing-line);
  transition: background 0.2s ease;
}

.landing-recipe-row:hover {
  background: var(--landing-panel);
}

.landing-recipe-number {
  color: #766f67;
  font-size: 10px;
}

.landing-recipe-thumb {
  overflow: hidden;
  aspect-ratio: 16 / 10;
  border-radius: 4px;
  background: #29231f;
}

.landing-recipe-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.78) contrast(1.06) brightness(0.95);
}

.landing-recipe-copy {
  display: grid;
  gap: 7px;
  min-width: 0;
}

.landing-recipe-copy strong {
  overflow: hidden;
  color: var(--landing-text);
  font-size: 15px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.landing-recipe-copy small,
.landing-recipe-spec {
  color: var(--landing-muted);
  font-size: 10px;
}

.landing-recipe-spec {
  letter-spacing: 1px;
  white-space: nowrap;
}

.landing-principles {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: clamp(50px, 9vw, 150px);
  border-top: 1px solid var(--landing-line);
}

.landing-principles-title h2 {
  max-width: 620px;
}

.landing-principles-list {
  border-top: 1px solid var(--landing-line);
}

.landing-principles-list article {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 16px;
  padding: 24px 0;
  border-bottom: 1px solid var(--landing-line);
}

.landing-principles-list article > span {
  color: var(--landing-accent);
  font-size: 10px;
}

.landing-principles-list strong {
  color: var(--landing-text);
  font-size: 15px;
  font-weight: 500;
}

.landing-principles-list p {
  max-width: 560px;
  margin: 8px 0 0;
  color: var(--landing-muted);
  font-size: 12px;
  line-height: 1.8;
}

.landing-final-cta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 110px 12% 120px;
  border-top: 1px solid var(--landing-line);
  background:
    radial-gradient(circle at 84% 30%, rgba(232, 121, 78, 0.1), transparent 34%),
    #1f1d1a;
}

.landing-final-cta h2 {
  max-width: 900px;
  margin-bottom: 22px;
  font-size: clamp(38px, 5vw, 76px);
  font-weight: 550;
  letter-spacing: 0;
  line-height: 1.12;
}

.landing-final-cta > p:not(.landing-eyebrow) {
  max-width: 560px;
  margin: 0 0 30px;
  color: var(--landing-muted);
  font-size: 14px;
  line-height: 1.85;
}

.landing-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  padding: 30px 4.5%;
  border-top: 1px solid var(--landing-line);
  color: #8d867d;
  font-size: 10px;
  letter-spacing: 0.6px;
}

.landing-footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--landing-text-soft);
  font-size: 13px;
}

.landing-footer p {
  margin: 0;
}

.landing-footer > div {
  display: flex;
  justify-content: flex-end;
  gap: 18px;
}

.landing-footer > div a:hover {
  color: var(--landing-text);
}

@media (max-width: 1100px) {
  .landing-desktop-nav {
    gap: 20px;
  }

  .landing-art-rail {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .landing-art-1,
  .landing-art-3,
  .landing-art-4 {
    padding-top: 0;
  }

  .landing-art-4,
  .landing-art-5 {
    grid-column: span 1;
  }
}

@media (max-width: 820px) {
  .landing-nav {
    height: 72px;
  }

  .landing-desktop-nav {
    display: none;
  }

  .landing-menu-toggle {
    display: grid;
  }

  .landing-workspace {
    height: 36px;
    padding: 0 12px;
  }

  .landing-hero {
    height: auto;
    min-height: 720px;
  }

  .landing-hero-art {
    object-position: 62% center;
  }

  .landing-hero-shade {
    background:
      linear-gradient(180deg, rgba(29, 28, 25, 0.24) 0%, rgba(29, 28, 25, 0.48) 38%, var(--landing-bg) 92%),
      linear-gradient(90deg, rgba(29, 28, 25, 0.68), transparent 80%);
  }

  .landing-hero-content {
    padding: 190px 6% 90px;
  }

  .landing-hero h1 {
    font-size: clamp(46px, 12vw, 68px);
    letter-spacing: 0;
  }

  .landing-hero-description {
    font-size: 14px;
  }

  .landing-hero-bottom {
    right: 6%;
    left: 6%;
  }

  .landing-section {
    padding: 72px 6%;
  }

  .landing-section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
  }

  .landing-art-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .landing-art-5 {
    grid-column: span 2;
  }

  .landing-art-5 .landing-art-image {
    aspect-ratio: 16 / 9;
  }

  .landing-motion-section {
    grid-template-columns: 1fr;
    gap: 38px;
    padding: 68px 6%;
  }

  .landing-motion-art {
    width: 100%;
    max-width: none;
    max-height: none;
    justify-self: stretch;
  }

  .landing-motion-copy {
    padding: 0;
  }

  .landing-recipe-row {
    grid-template-columns: 34px 68px minmax(0, 1fr) 18px;
    gap: 14px;
    padding: 16px 0;
  }

  .landing-recipe-spec {
    display: none;
  }

  .landing-principles {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .landing-final-cta {
    padding: 80px 8%;
  }

  .landing-footer {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .landing-footer > div {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .landing-nav {
    padding: 0 4%;
  }

  .landing-brand {
    font-size: 18px;
  }

  .landing-nav-actions {
    gap: 4px;
  }

  .landing-workspace {
    gap: 4px;
    height: 34px;
    padding: 0 8px;
    font-size: 10px;
  }

  .landing-hero {
    min-height: 680px;
  }

  .landing-hero-content {
    padding-right: 5%;
    padding-left: 5%;
    padding-top: 150px;
  }

  .landing-hero h1 {
    overflow-wrap: anywhere;
    font-size: clamp(38px, 10.4vw, 52px);
    letter-spacing: 0;
    line-height: 1.16;
  }

  .landing-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .landing-button {
    width: 100%;
  }

  .landing-art-rail {
    grid-template-columns: 1fr;
  }

  .landing-art-5 {
    grid-column: auto;
  }

  .landing-art-image,
  .landing-art-5 .landing-art-image {
    aspect-ratio: 4 / 5;
  }

  .landing-recipe-row {
    grid-template-columns: 28px 58px minmax(0, 1fr) 16px;
    gap: 11px;
  }

  .landing-recipe-copy strong {
    font-size: 13px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-hero-art {
    animation: none;
  }

  .landing-shell *,
  .landing-shell *::before,
  .landing-shell *::after {
    transition-duration: 0.01ms !important;
  }
}
</style>
