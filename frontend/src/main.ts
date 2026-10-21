import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { DEFAULT_SITE_NAME } from '@/constants/brand'
import App from './App.vue'
import router from './router'
import i18n, { initI18n } from './i18n'
import { useAppStore } from '@/stores/app'
import { updateFavicon } from '@/utils/branding'
import { isIOSDevice } from '@/utils/device'
import './style.css'

function initIOSViewportZoomFix() {
  // iOS Safari 在输入框字号小于 16px 时聚焦会自动放大页面，且失焦后不会恢复。
  // 限制 maximum-scale 可阻止该行为；iOS 10+ 用户仍可双指手动缩放，不影响可访问性。
  // 仅在 iOS 设备上注入，避免影响 Android Chrome 的手动缩放能力。
  if (!isIOSDevice()) return

  const viewport = document.querySelector('meta[name="viewport"]')
  if (!viewport) return

  const content = viewport.getAttribute('content') || ''
  if (/maximum-scale/i.test(content)) return
  viewport.setAttribute('content', `${content}, maximum-scale=1.0`)
}

function initThemeClass() {
  const savedTheme = localStorage.getItem('theme')
  const shouldUseDark = savedTheme !== 'light'
  document.documentElement.classList.toggle('dark', shouldUseDark)
}

function renderBootFailure(error?: unknown) {
  console.error('Application bootstrap failed:', error)
  const app = document.getElementById('app')
  if (!app) return
  app.innerHTML = `
    <div class="boot-screen" role="alert">
      <div class="boot-mark">C</div>
      <p class="boot-title">页面加载失败</p>
      <p class="boot-subtitle">可能是网络波动或版本更新导致，请刷新重试。</p>
      <button id="boot-retry-button" type="button">重新加载页面</button>
    </div>
  `
  const retry = document.getElementById('boot-retry-button')
  retry?.addEventListener('click', () => window.location.reload())
}

async function bootstrap() {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual'
  }
  // Apply theme class globally before app mount to keep all routes consistent.
  initThemeClass()
  initIOSViewportZoomFix()

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // Initialize settings from injected config BEFORE mounting (prevents flash)
  // This must happen after pinia is installed but before router and i18n
  const appStore = useAppStore()
  appStore.initFromInjectedConfig()

  // Set document title immediately after config is loaded
  if (appStore.siteName && appStore.siteName !== DEFAULT_SITE_NAME) {
    document.title = `${appStore.siteName} - AI 视频与图片生成`
  }
  updateFavicon(appStore.siteLogo)

  await initI18n()

  app.use(router)
  app.use(i18n)

  // 等待路由器完成初始导航后再挂载，避免竞态条件导致的空白渲染。
  // 路由分包或会话接口异常时不能无限空白，超时后给出可操作的错误页。
  await Promise.race([
    router.isReady(),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('ROUTER_READY_TIMEOUT')), 15_000)
    }),
  ])
  app.mount('#app')
}

bootstrap().catch((error) => {
  renderBootFailure(error)
})
