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
      <section class="landing-hero">
        <img class="landing-hero-art" src="/landing/hero-cassini.jpg" alt="" fetchpriority="high" />
        <div class="landing-hero-shade" />
        <div class="landing-hero-content">
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
          <span class="landing-hero-count">01 / 03</span>
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
          <img src="/landing/desert.jpg" :alt="t('home.landing.filmTitle')" loading="lazy" />
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
import { computed, ref } from 'vue'
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
    title: t('home.landing.gallery.items.desert'),
    meta: 'CINEMATIC / 02',
    image: '/landing/desert.jpg',
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
    title: t('home.landing.gallery.items.rings'),
    meta: 'COSMIC / 05',
    image: '/landing/rings.jpg',
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
    image: '/landing/rings.jpg',
    to: videoTarget.value,
  },
  {
    title: t('home.landing.notebook.items.landscape.title'),
    meta: t('home.landing.notebook.items.landscape.meta'),
    spec: '08s / 21:9',
    image: '/landing/desert.jpg',
    to: videoTarget.value,
  },
  {
    title: t('home.landing.notebook.items.botanical.title'),
    meta: t('home.landing.notebook.items.botanical.meta'),
    spec: '04s / 9:16',
    image: '/landing/flower.jpg',
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
  --landing-bg: #09090b;
  --landing-panel: #141416;
  --landing-line: #2c2c30;
  --landing-muted: #a5a5ae;
  --landing-accent: #ff693b;
  min-height: 100vh;
  overflow: clip;
  background: var(--landing-bg);
  color: #f5f5f5;
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
  color: #09090b;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #09090b;
}

.landing-brand {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: #fff;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -0.8px;
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
  color: #c0c0c6;
  font-size: 13px;
}

.landing-desktop-nav a {
  transition: color 0.2s ease;
}

.landing-desktop-nav a:hover {
  color: #fff;
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
  color: #1b100b !important;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  transition: background 0.2s ease;
}

.landing-workspace:hover {
  background: #ff845b;
}

.landing-menu-toggle {
  display: none;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--landing-line);
  border-radius: 7px;
  background: transparent;
  color: #fff;
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
  isolation: isolate;
  background: #08080b;
}

.landing-hero-art {
  position: absolute;
  inset: 0;
  z-index: -3;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 52%;
  filter: sepia(0.18) saturate(1.14) contrast(1.05);
  animation: landing-hero-reveal 1.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.landing-hero-shade {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(circle at 76% 42%, rgba(255, 105, 59, 0.18), transparent 34%),
    linear-gradient(90deg, rgba(8, 8, 11, 0.96) 0%, rgba(8, 8, 11, 0.82) 34%, rgba(8, 8, 11, 0.28) 63%, transparent 100%),
    linear-gradient(0deg, #09090b 0%, transparent 28%);
}

.landing-hero-content {
  width: 100%;
  padding: 30px 4.5% 90px;
}

.landing-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 24px;
  color: #b6b6bd;
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
  color: #fff;
  font-size: clamp(54px, 6.1vw, 94px);
  font-weight: 650;
  letter-spacing: -4px;
  line-height: 1.12;
}

.landing-hero h1 span {
  color: #ff7646;
}

.landing-hero-description {
  max-width: 560px;
  margin: 0 0 30px;
  color: #d0d0d6;
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
  color: #110b08 !important;
}

.landing-button-primary:hover {
  background: #ff845b;
}

.landing-button-glass {
  border-color: rgba(190, 178, 171, 0.48);
  background: rgba(20, 20, 22, 0.58);
  color: #fff !important;
  backdrop-filter: blur(12px);
}

.landing-button-light {
  background: #f1f0ed;
  color: #111 !important;
}

.landing-hero-models {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
  color: #aaaab1;
  font-size: 10px;
  letter-spacing: 1.5px;
}

.landing-hero-models span + span::before {
  margin-right: 12px;
  color: #62626b;
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
  color: #9999a1;
  font-size: 10px;
  letter-spacing: 1px;
}

.landing-hero-count {
  padding: 8px 11px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 3px;
  background: rgba(10, 10, 12, 0.5);
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
  color: #f5f5f5;
  font-size: clamp(28px, 3.1vw, 46px);
  font-weight: 550;
  letter-spacing: -1.5px;
  line-height: 1.28;
}

.landing-text-link {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 6px 0;
  color: #dedee3;
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
  background: #18181b;
}

.landing-art-1 .landing-art-image,
.landing-art-3 .landing-art-image {
  aspect-ratio: 1 / 1.08;
}

.landing-art-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.82) contrast(1.05);
  transition: transform 0.65s cubic-bezier(0.2, 0.65, 0.3, 1), filter 0.3s ease;
}

.landing-art-piece:hover .landing-art-image img {
  filter: saturate(1.05) contrast(1.08);
  transform: scale(1.05);
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
  background: rgba(255, 255, 255, 0.86);
  color: #111;
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
  color: #f1f1f4;
  font-size: 13px;
  font-weight: 500;
}

.landing-art-caption span {
  color: #85858f;
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
  background: #111113;
}

.landing-motion-art {
  position: relative;
  width: 100%;
  max-width: 860px;
  max-height: 560px;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  justify-self: end;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.landing-motion-art::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 55%, rgba(17, 17, 19, 0.72));
  content: '';
}

.landing-motion-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: sepia(0.25) saturate(1.15) contrast(1.06);
}

.landing-image-label {
  position: absolute;
  bottom: 24px;
  left: 24px;
  z-index: 1;
  color: #dedee3;
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
  color: #91919a;
}

.landing-body-copy {
  max-width: 550px;
  margin: 0;
  color: #b7b7c0;
  font-size: 15px;
  line-height: 1.9;
}

.landing-feature-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 15px 25px;
  margin: 30px 0 34px;
  padding: 0;
  color: #c2c2c9;
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
  color: #65656f;
  font-size: 10px;
}

.landing-recipe-thumb {
  overflow: hidden;
  aspect-ratio: 16 / 10;
  border-radius: 4px;
  background: #282321;
}

.landing-recipe-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.75) contrast(1.08);
}

.landing-recipe-copy {
  display: grid;
  gap: 7px;
  min-width: 0;
}

.landing-recipe-copy strong {
  overflow: hidden;
  color: #f3f3f5;
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
  color: #f3f3f5;
  font-size: 15px;
  font-weight: 500;
}

.landing-principles-list p {
  max-width: 560px;
  margin: 8px 0 0;
  color: #9696a1;
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
    radial-gradient(circle at 84% 30%, rgba(255, 105, 59, 0.15), transparent 32%),
    #0d0d10;
}

.landing-final-cta h2 {
  max-width: 900px;
  margin-bottom: 22px;
  font-size: clamp(38px, 5vw, 76px);
  font-weight: 550;
  letter-spacing: -2.5px;
  line-height: 1.12;
}

.landing-final-cta > p:not(.landing-eyebrow) {
  max-width: 560px;
  margin: 0 0 30px;
  color: #aaaab3;
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
  color: #7f7f89;
  font-size: 10px;
  letter-spacing: 0.6px;
}

.landing-footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #ddd;
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
  color: #fff;
}

@keyframes landing-hero-reveal {
  from {
    opacity: 0;
    transform: scale(1.035);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
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
      linear-gradient(180deg, rgba(8, 8, 11, 0.32) 0%, rgba(8, 8, 11, 0.55) 38%, #09090b 92%),
      linear-gradient(90deg, rgba(8, 8, 11, 0.75), transparent 80%);
  }

  .landing-hero-content {
    padding: 190px 6% 90px;
  }

  .landing-hero h1 {
    font-size: clamp(46px, 12vw, 68px);
    letter-spacing: -2.5px;
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
    letter-spacing: -1.5px;
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
