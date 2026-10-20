<template>
  <div v-if="variant === 'split'" class="auth-split-shell">
    <aside class="auth-split-visual">
      <img src="/landing/desert.jpg" alt="" class="auth-split-visual-image" />
      <div class="auth-split-visual-shade"></div>
      <div class="auth-split-visual-content">
        <RouterLink to="/home" class="auth-split-brand">
          <span>{{ siteName }}</span>
        </RouterLink>

        <div class="auth-split-visual-copy">
          <p class="auth-split-eyebrow"><span></span>{{ t('home.landing.eyebrow') }}</p>
          <h1>
            {{ t('home.landing.titleTop') }}<br />
            <em>{{ t('home.landing.titleAccent') }}</em>
          </h1>
          <p>{{ t('home.landing.description') }}</p>
        </div>

        <div class="auth-split-meta">
          <span>GPT IMAGE</span>
          <span>SEEDANCE</span>
          <span>GROK IMAGINE</span>
        </div>
      </div>
    </aside>

    <main class="auth-split-panel">
      <div class="auth-split-panel-top">
        <RouterLink to="/home" class="auth-split-back">
          <Icon name="arrowLeft" size="sm" />
          {{ t('auth.backToHome') }}
        </RouterLink>
        <LocaleSwitcher />
      </div>

      <div class="auth-split-panel-body">
        <RouterLink to="/home" class="auth-split-mobile-brand">
          <span>{{ siteName }}</span>
        </RouterLink>

        <div class="auth-split-form">
          <slot />
        </div>
        <div class="auth-split-footer">
          <slot name="footer" />
        </div>
      </div>

      <p class="auth-split-copyright">
        &copy; {{ currentYear }} {{ siteName }}. {{ t('home.footer.allRightsReserved') }}
      </p>
    </main>
  </div>

  <div v-else class="relative flex min-h-screen items-center justify-center overflow-hidden p-3 sm:p-4">
    <!-- Background -->
    <div
      class="absolute inset-0 bg-gradient-to-br from-gray-50 via-primary-50/30 to-gray-100 dark:from-dark-950 dark:via-dark-900 dark:to-dark-950"
    ></div>

    <!-- Decorative Elements -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <!-- Gradient Orbs -->
      <div
        class="absolute -right-40 -top-40 h-80 w-80 rounded-full bg-primary-400/20 blur-3xl"
      ></div>
      <div
        class="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary-500/15 blur-3xl"
      ></div>
      <div
        class="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-300/10 blur-3xl"
      ></div>

      <!-- Grid Pattern -->
      <div
        class="absolute inset-0 bg-[linear-gradient(rgba(20,184,166,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(20,184,166,0.03)_1px,transparent_1px)] bg-[size:64px_64px]"
      ></div>
    </div>

    <!-- Content Container -->
    <div :class="contentClass">
      <!-- Logo/Brand -->
      <div v-if="showBrand" class="auth-brand mb-4 text-center sm:mb-5">
        <!-- Custom Logo or Default Logo -->
        <template v-if="settingsLoaded">
          <div
            class="auth-logo mb-2 inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl shadow-lg shadow-primary-500/25"
          >
            <img :src="siteLogo || '/logo.svg'" alt="Logo" class="h-full w-full object-contain" />
          </div>
          <h1 class="text-gradient text-2xl font-bold leading-tight">
            {{ siteName }}
          </h1>
          <p class="auth-subtitle mt-1 text-xs text-gray-500 dark:text-dark-400">
            {{ siteSubtitle }}
          </p>
        </template>
      </div>

      <!-- Card Container -->
      <div :class="cardClass">
        <slot />
      </div>

      <!-- Footer Links -->
      <div :class="footerClass">
        <slot name="footer" />
      </div>

      <!-- Copyright -->
      <div v-if="showCopyright" :class="copyrightClass">
        &copy; {{ currentYear }} {{ siteName }}. {{ t('home.footer.allRightsReserved') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores'
import { sanitizeUrl } from '@/utils/url'
import { normalizeSiteName } from '@/constants/brand'
import LocaleSwitcher from '@/components/common/LocaleSwitcher.vue'
import Icon from '@/components/icons/Icon.vue'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  showBrand?: boolean
  showCopyright?: boolean
  compact?: boolean
  variant?: 'centered' | 'split'
}>(), {
  showBrand: true,
  showCopyright: true,
  compact: false,
  variant: 'centered'
})

const appStore = useAppStore()

const siteName = computed(() => normalizeSiteName(appStore.siteName))
const siteLogo = computed(() => sanitizeUrl(appStore.siteLogo || '', { allowRelative: true, allowDataUrl: true }))
const siteSubtitle = computed(() => appStore.cachedPublicSettings?.site_subtitle || 'Create AI Platform')
const settingsLoaded = computed(() => appStore.publicSettingsLoaded)

const currentYear = computed(() => new Date().getFullYear())
const contentClass = computed(() => [
  'relative z-10 w-full',
  props.compact ? 'max-w-[390px] py-2 sm:py-3' : 'max-w-md py-4 sm:py-6'
])
const cardClass = computed(() => [
  'card-glass rounded-2xl shadow-glass',
  props.compact ? 'p-4 sm:p-5' : 'p-6 sm:p-7'
])
const footerClass = computed(() => [
  'text-center text-sm',
  props.compact ? 'mt-3' : 'mt-6'
])
const copyrightClass = computed(() => [
  'text-center text-xs text-gray-400 dark:text-dark-500',
  props.compact ? 'mt-4' : 'mt-8'
])

onMounted(() => {
  appStore.fetchPublicSettings()
})
</script>

<style scoped>
.text-gradient {
  @apply bg-gradient-to-r from-primary-600 to-primary-500 bg-clip-text text-transparent;
}

.auth-split-shell {
  --auth-bg: #1d1c19;
  --auth-panel: #211f1c;
  --auth-panel-deep: #171614;
  --auth-line: #3a3630;
  --auth-muted: #aaa39a;
  --auth-text: #f2ede5;
  --auth-text-soft: #d8d1c7;
  --auth-accent: #e8794e;
  --auth-accent-soft: #f09873;
  display: grid;
  grid-template-columns: minmax(0, 1.24fr) minmax(420px, 0.76fr);
  min-height: 100svh;
  overflow: hidden;
  background: var(--auth-bg);
  color: var(--auth-text);
  font-family: Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.auth-split-shell *,
.auth-split-shell *::before,
.auth-split-shell *::after {
  box-sizing: border-box;
}

.auth-split-visual {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
}

.auth-split-visual-image {
  position: absolute;
  inset: 0;
  z-index: -3;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 58%;
  filter: sepia(0.1) saturate(0.94) contrast(1.03) brightness(0.96);
  animation: auth-split-reveal 1.25s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.auth-split-visual-shade {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(circle at 76% 42%, rgba(232, 121, 78, 0.14), transparent 40%),
    linear-gradient(90deg, rgba(29, 28, 25, 0.86) 0%, rgba(29, 28, 25, 0.54) 44%, rgba(29, 28, 25, 0.04) 100%),
    linear-gradient(0deg, var(--auth-bg) 0%, transparent 34%);
}

.auth-split-visual-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  min-height: 100svh;
  padding: 38px 7% 46px;
}

.auth-split-brand,
.auth-split-mobile-brand {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  color: var(--auth-text);
  font-size: 21px;
  font-weight: 650;
  letter-spacing: 0;
}

.auth-split-visual-copy {
  max-width: 700px;
  margin: auto 0;
}

.auth-split-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 24px;
  color: var(--auth-text-soft);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
}

.auth-split-eyebrow span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--auth-accent);
}

.auth-split-visual-copy h1 {
  margin: 0 0 26px;
  color: var(--auth-text);
  font-size: clamp(52px, 5.4vw, 82px);
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.13;
}

.auth-split-visual-copy h1 em {
  color: var(--auth-accent-soft);
  font-style: normal;
}

.auth-split-visual-copy > p:last-child {
  max-width: 520px;
  margin: 0;
  color: var(--auth-text-soft);
  font-size: 15px;
  line-height: 1.85;
}

.auth-split-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--auth-muted);
  font-size: 9px;
  letter-spacing: 1.5px;
}

.auth-split-meta span + span::before {
  margin-right: 12px;
  color: #6f6961;
  content: '·';
}

.auth-split-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  overflow-y: auto;
  padding: 32px clamp(28px, 5vw, 76px) 26px;
  border-left: 1px solid rgba(238, 229, 216, 0.1);
  background: var(--auth-panel);
}

.auth-split-panel-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.auth-split-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--auth-muted);
  font-size: 11px;
  transition: color 0.2s ease;
}

.auth-split-back:hover {
  color: var(--auth-text);
}

.auth-split-panel-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  max-width: 430px;
  margin: auto;
  padding: 34px 0;
}

.auth-split-mobile-brand {
  display: none;
  margin-bottom: 30px;
}

.auth-split-form :deep(.input-label) {
  margin-bottom: 9px;
  color: var(--auth-text-soft);
  font-size: 12px;
  font-weight: 500;
}

.auth-split-form :deep(.input) {
  height: 48px;
  border: 1px solid var(--auth-line);
  border-radius: 6px;
  background: var(--auth-panel-deep);
  color: var(--auth-text);
  font-size: 13px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.auth-split-form :deep(.input::placeholder) {
  color: #777168;
}

.auth-split-form :deep(.input:focus) {
  border-color: var(--auth-accent);
  outline: none;
  box-shadow: 0 0 0 3px rgba(232, 121, 78, 0.14);
}

.auth-split-form :deep(.input-error) {
  border-color: #e05244;
}

.auth-split-form :deep(.btn) {
  min-height: 48px;
  border-radius: 5px;
  font-size: 13px;
}

.auth-split-form :deep(.btn-primary) {
  border: 1px solid transparent;
  background: var(--auth-accent);
  color: #1c120d;
  box-shadow: none;
}

.auth-split-form :deep(.btn-primary:hover) {
  background: var(--auth-accent-soft);
}

.auth-split-form :deep(.btn-secondary) {
  border: 1px solid #403b34;
  background: #1d1b18;
  color: var(--auth-text);
}

.auth-split-form :deep(a.text-primary-600),
.auth-split-form :deep(a.text-primary-400),
.auth-split-footer :deep(a) {
  color: var(--auth-accent-soft);
}

.auth-split-form :deep(.auth-form-title) {
  color: var(--auth-text);
}

.auth-split-form :deep(.auth-form-subtitle) {
  color: #938c83;
}

.auth-split-footer {
  margin-top: 26px;
  color: #938c83;
  font-size: 12px;
  text-align: center;
}

.auth-split-copyright {
  margin: auto 0 0;
  color: #756f66;
  font-size: 9px;
  letter-spacing: 0.5px;
  text-align: center;
}

@keyframes auth-split-reveal {
  from {
    opacity: 0;
    transform: scale(1.035);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 980px) {
  .auth-split-shell {
    grid-template-columns: minmax(0, 1fr) minmax(390px, 0.9fr);
  }

  .auth-split-visual-copy h1 {
    font-size: clamp(42px, 6vw, 62px);
    letter-spacing: 0;
  }
}

@media (max-width: 760px) {
  .auth-split-shell {
    display: block;
    min-height: 100svh;
  }

  .auth-split-visual {
    display: none;
  }

  .auth-split-panel {
    min-height: 100svh;
    padding: 24px 24px 22px;
    border-left: 0;
  }

  .auth-split-panel-body {
    max-width: 430px;
  }

  .auth-split-mobile-brand {
    display: inline-flex;
  }
}

@media (max-width: 420px) {
  .auth-split-panel {
    padding-right: 18px;
    padding-left: 18px;
  }
}

@media (max-height: 820px) {
  .auth-logo,
  .auth-subtitle {
    display: none;
  }

  .auth-brand {
    margin-bottom: 0.75rem;
  }
}

@media (max-height: 720px) {
  .auth-brand {
    display: none;
  }
}
</style>
