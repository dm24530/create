<template>
  <div class="download-shell">
    <header class="download-nav">
      <RouterLink to="/home" class="download-brand">
        <img :src="siteLogo || '/logo.svg'" alt="" class="download-brand-logo" />
        <span>{{ siteName }}</span>
      </RouterLink>

      <nav class="download-links" aria-label="Primary">
        <RouterLink to="/home">{{ localText("首页", "Home") }}</RouterLink>
        <RouterLink v-if="showModelPlazaEntry" :to="modelPlazaDestination">
          {{ localText("模型广场", "Models") }}
        </RouterLink>
        <RouterLink to="/download" class="is-active">
          {{ localText("客户端", "Desktop") }}
        </RouterLink>
      </nav>

      <div class="download-nav-actions">
        <LocaleSwitcher />
        <RouterLink :to="authStore.isAuthenticated ? dashboardPath : '/login'" class="download-login">
          {{ authStore.isAuthenticated ? localText("进入工作台", "Workspace") : localText("登录", "Sign in") }}
          <Icon name="arrowRight" size="sm" />
        </RouterLink>
      </div>
    </header>

    <main class="download-main">
      <section class="download-hero">
        <div class="download-hero-copy">
          <div class="download-eyebrow">
            <span class="download-live-dot"></span>
            CREATE DESKTOP · WINDOWS / MACOS
          </div>
          <h1>
            {{ localText("让创作发生", "Create at your desk") }}<br />
            <span>{{ localText("在本地，更快也更自由。", "Local-first. Faster. Yours.") }}</span>
          </h1>
          <p class="download-lead">
            {{
              localText(
                "一样的 Create 工作台与无限画布，安装后直接使用。图片与视频处理在本地完成，服务器只负责登录、密钥与上游 API 连接，不代理安装包，也不接管你的本地文件。",
                "The same Create workbench and infinite canvas, now as a desktop app. Media work stays local while the server only handles sign-in, API keys, and upstream connections. Installers and local files are never proxied by the app server.",
              )
            }}
          </p>

          <div class="download-feature-row">
            <span><Icon name="cpu" size="sm" />{{ localText("本地处理", "Local processing") }}</span>
            <span><Icon name="shield" size="sm" />{{ localText("私密保存", "Private storage") }}</span>
            <span><Icon name="cloud" size="sm" />{{ localText("云端账号", "Cloud account") }}</span>
          </div>

          <div class="download-primary-card">
            <div>
              <p class="download-card-kicker">{{ localText("推荐下载", "Recommended") }}</p>
              <h2>{{ primaryLabel }}</h2>
              <p>
                <template v-if="loading">{{ localText("正在读取发布信息…", "Loading release information…") }}</template>
                <template v-else-if="loadError">{{ localText("发布信息读取失败，请重试。", "Could not load release information. Please retry.") }}</template>
                <template v-else-if="!releaseAvailable">{{ localText("客户端正在准备中，请稍后再来。", "The desktop app is being prepared. Please check back soon.") }}</template>
                <template v-else>
                  v{{ release.version }}
                  <span v-if="release.published_at"> · {{ release.published_at }}</span>
                </template>
              </p>
            </div>
            <a
              v-if="releaseAvailable && primaryDownload"
              :href="primaryDownload"
              class="download-primary-button"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="download" size="sm" />
              {{ localText("立即下载", "Download now") }}
            </a>
            <button
              v-else
              type="button"
              class="download-primary-button"
              :disabled="loading || (!releaseAvailable && !loadError)"
              @click="loadRelease"
            >
              <Icon :name="loading ? 'refresh' : 'download'" size="sm" :class="{ 'download-spin': loading }" />
              {{ loading ? localText("加载中", "Loading") : loadError ? localText("重新加载", "Retry") : localText("暂未发布", "Coming soon") }}
            </button>
          </div>
        </div>

        <aside class="download-visual" aria-hidden="true">
          <div class="download-visual-orbit download-visual-orbit-a"></div>
          <div class="download-visual-orbit download-visual-orbit-b"></div>
          <div class="download-window">
            <div class="download-window-bar">
              <span></span><span></span><span></span>
              <strong>CREATE / LOCAL</strong>
            </div>
            <div class="download-window-body">
              <div class="download-window-rail">
                <i></i><i></i><i></i><i></i>
              </div>
              <div class="download-window-canvas">
                <div class="download-window-tile tile-a"></div>
                <div class="download-window-tile tile-b"></div>
                <div class="download-window-tile tile-c"></div>
                <div class="download-window-cursor"></div>
              </div>
            </div>
          </div>
          <div class="download-visual-chip chip-a">{{ localText("本地生成", "Local render") }}</div>
          <div class="download-visual-chip chip-b">{{ localText("自动保存", "Autosave") }}</div>
          <div class="download-visual-chip chip-c">API / R2</div>
        </aside>
      </section>

      <section class="download-section">
        <div class="download-section-heading">
          <div>
            <p class="download-section-kicker">01 / CHOOSE YOUR BUILD</p>
            <h2>{{ localText("选择你的平台", "Choose your platform") }}</h2>
          </div>
          <p>
            {{
              localText(
                "安装包由对象存储直链提供，下载速度取决于你所在地区的网络。",
                "Installers are served directly from object storage; download speed depends on your region.",
              )
            }}
          </p>
        </div>

        <div class="download-grid">
          <article
            v-for="item in downloadItems"
            :key="item.key"
            class="download-platform-card"
            :class="{ 'is-recommended': item.key === primaryKey }"
          >
            <div class="download-platform-head">
              <div class="download-platform-icon" :class="`platform-${item.key}`">
                <span v-if="item.key === 'windows_x64'">WIN</span>
                <span v-else>MAC</span>
              </div>
              <span v-if="item.key === primaryKey" class="download-recommended">
                {{ localText("推荐", "Recommended") }}
              </span>
            </div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <a
              v-if="item.url"
              :href="item.url"
              class="download-platform-button"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="download" size="sm" />
              {{ localText("下载安装包", "Download installer") }}
            </a>
            <span v-else class="download-platform-button is-disabled">
              {{ releaseAvailable ? localText("此平台暂未提供", "Not available yet") : localText("暂未发布", "Coming soon") }}
            </span>
          </article>
        </div>
      </section>

      <section v-if="releaseAvailable" class="download-info-grid">
        <article class="download-info-card">
          <p class="download-section-kicker">02 / WHAT'S NEW</p>
          <h2>{{ localText("本次更新", "What's new") }}</h2>
          <div v-if="release.notes" class="download-release-notes">{{ release.notes }}</div>
          <p v-else class="download-muted">{{ localText("暂无更新说明。", "No release notes yet.") }}</p>
          <div class="download-meta-row">
            <span>{{ localText("最新版本", "Latest version") }} <strong>v{{ release.version }}</strong></span>
            <span v-if="release.minimum_version">{{ localText("最低版本", "Minimum") }} <strong>v{{ release.minimum_version }}</strong></span>
          </div>
        </article>

        <article class="download-info-card download-system-card">
          <p class="download-section-kicker">03 / SYSTEM NOTES</p>
          <h2>{{ localText("安装前请确认", "Before installing") }}</h2>
          <ul>
            <li>{{ localText("Windows 建议使用 Windows 10/11 x64。", "Windows 10/11 x64 is recommended.") }}</li>
            <li>{{ localText("Apple Silicon 与 Intel Mac 请选择对应安装包。", "Choose the correct Apple Silicon or Intel Mac build.") }}</li>
            <li>{{ localText("首次登录仍使用你的 Create 云端账号。", "Sign in with your existing Create cloud account.") }}</li>
            <li>{{ localText("生成结果保存在你配置的本地目录。", "Generated media is saved to the local directory you configure.") }}</li>
          </ul>
        </article>
      </section>

      <section v-if="releaseAvailable && release.update_base_url" class="download-update-note">
        <Icon name="refresh" size="md" />
        <div>
          <strong>{{ localText("后续自动更新", "Future automatic updates") }}</strong>
          <p>
            {{
              localText(
                "桌面端将从发布目录读取更新清单，并在新版本可用时提示你。更新包同样由对象存储直接下载。",
                "The desktop app will read its updater manifest from the release directory and prompt when a new version is available. Update packages are also downloaded directly from object storage.",
              )
            }}
          </p>
        </div>
      </section>
    </main>

    <footer class="download-footer">
      <span>&copy; {{ currentYear }} {{ siteName }}</span>
      <div>
        <RouterLink to="/home">{{ localText("首页", "Home") }}</RouterLink>
        <RouterLink v-if="showModelPlazaEntry" :to="modelPlazaDestination">{{ localText("模型广场", "Models") }}</RouterLink>
        <RouterLink to="/login">{{ localText("登录", "Sign in") }}</RouterLink>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import LocaleSwitcher from "@/components/common/LocaleSwitcher.vue";
import Icon from "@/components/icons/Icon.vue";
import { getCreateClientRelease, type CreateClientRelease } from "@/api/appRelease";
import { useAppStore, useAuthStore } from "@/stores";
import { FeatureFlags, isFeatureFlagEnabled } from "@/utils/featureFlags";
import { normalizeSiteName } from "@/constants/brand";
import { sanitizeUrl } from "@/utils/url";

type PlatformKey = "windows_x64" | "macos_arm64" | "macos_x64";

const { locale } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const loading = ref(true);
const loadError = ref(false);
const release = ref<CreateClientRelease>({
  enabled: false,
  version: "",
  published_at: "",
  minimum_version: "",
  notes: "",
  update_base_url: "",
  downloads: {
    windows_x64: "",
    macos_arm64: "",
    macos_x64: "",
  },
});
const detectedPlatform = ref<"windows" | "macos" | "unknown">("unknown");

const isZh = computed(() => locale.value.startsWith("zh"));
const siteName = computed(() =>
  normalizeSiteName(appStore.cachedPublicSettings?.site_name || appStore.siteName),
);
const siteLogo = computed(() =>
  sanitizeUrl(appStore.cachedPublicSettings?.site_logo || appStore.siteLogo || "", {
    allowRelative: true,
    allowDataUrl: true,
  }),
);
const dashboardPath = computed(() =>
  authStore.isAdmin ? "/admin/dashboard" : "/image-studio",
);
const modelPlazaDestination = computed(() =>
  authStore.isAuthenticated
    ? { path: "/image-studio", query: { openModelPlaza: "1" } }
    : "/model-plaza",
);
const showModelPlazaEntry = computed(() =>
  isFeatureFlagEnabled(FeatureFlags.modelPlaza),
);
const releaseAvailable = computed(
  () =>
    release.value.enabled &&
    Boolean(release.value.version) &&
    Boolean(
      release.value.downloads.windows_x64 ||
        release.value.downloads.macos_arm64 ||
        release.value.downloads.macos_x64,
    ),
);
const currentYear = computed(() => new Date().getFullYear());

const downloadItems = computed(() => [
  {
    key: "windows_x64" as PlatformKey,
    title: "Windows 10 / 11",
    description: localText("64 位安装包 · .exe", "64-bit installer · .exe"),
    url: release.value.downloads.windows_x64,
  },
  {
    key: "macos_arm64" as PlatformKey,
    title: "macOS · Apple Silicon",
    description: localText("M1 / M2 / M3 / M4 · .dmg", "M1 / M2 / M3 / M4 · .dmg"),
    url: release.value.downloads.macos_arm64,
  },
  {
    key: "macos_x64" as PlatformKey,
    title: "macOS · Intel",
    description: localText("Intel Mac · .dmg", "Intel Mac · .dmg"),
    url: release.value.downloads.macos_x64,
  },
]);

const primaryKey = computed<PlatformKey | null>(() => {
  if (detectedPlatform.value === "windows" && release.value.downloads.windows_x64) {
    return "windows_x64";
  }
  if (detectedPlatform.value === "macos") {
    if (release.value.downloads.macos_arm64) return "macos_arm64";
    if (release.value.downloads.macos_x64) return "macos_x64";
  }
  const firstAvailable = downloadItems.value.find((item) => Boolean(item.url));
  return firstAvailable?.key ?? null;
});
const primaryDownload = computed(() =>
  primaryKey.value ? release.value.downloads[primaryKey.value] : "",
);
const primaryLabel = computed(() => {
  switch (primaryKey.value) {
    case "windows_x64":
      return localText("Windows x64 客户端", "Create for Windows x64");
    case "macos_arm64":
      return localText("macOS Apple Silicon 客户端", "Create for Apple Silicon");
    case "macos_x64":
      return localText("macOS Intel 客户端", "Create for Intel Mac");
    default:
      return localText("Create 桌面客户端", "Create Desktop");
  }
});

function localText(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function detectPlatform() {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) {
    detectedPlatform.value = "windows";
  } else if (userAgent.includes("macintosh") || userAgent.includes("mac os")) {
    detectedPlatform.value = "macos";
  } else {
    detectedPlatform.value = "unknown";
  }
}

async function loadRelease() {
  loading.value = true;
  loadError.value = false;
  try {
    release.value = await getCreateClientRelease();
  } catch (error) {
    console.warn("Failed to load Create client release", error);
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  detectPlatform();
  if (!appStore.publicSettingsLoaded) {
    void appStore.fetchPublicSettings();
  }
  await loadRelease();
});
</script>

<style scoped>
.download-shell {
  --dl-accent: #f07a4f;
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 15% 10%, rgba(240, 122, 79, 0.16), transparent 28rem),
    radial-gradient(circle at 85% 24%, rgba(58, 130, 246, 0.14), transparent 30rem),
    #0b0c0f;
  color: #f7f4ef;
}
.download-nav,
.download-main,
.download-footer {
  width: min(1180px, calc(100% - 40px));
  margin-inline: auto;
}
.download-nav {
  min-height: 82px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.download-brand,
.download-login,
.download-links a,
.download-footer a {
  color: inherit;
  text-decoration: none;
}
.download-brand {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.download-brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.06);
}
.download-links {
  display: flex;
  align-items: center;
  gap: 28px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 14px;
}
.download-links a:hover,
.download-links a.is-active {
  color: #fff;
}
.download-nav-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
.download-login {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  padding: 10px 16px;
  font-size: 14px;
  transition: 160ms ease;
}
.download-login:hover {
  border-color: var(--dl-accent);
  background: rgba(240, 122, 79, 0.12);
}
.download-main {
  padding: 72px 0 48px;
}
.download-hero {
  min-height: 580px;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  align-items: center;
  gap: 62px;
}
.download-eyebrow,
.download-section-kicker,
.download-card-kicker {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.download-eyebrow {
  display: flex;
  align-items: center;
  gap: 9px;
}
.download-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dl-accent);
  box-shadow: 0 0 18px var(--dl-accent);
}
.download-hero h1 {
  margin: 22px 0 25px;
  font-size: clamp(48px, 6vw, 82px);
  line-height: 0.98;
  letter-spacing: -0.065em;
}
.download-hero h1 span {
  color: rgba(255, 255, 255, 0.48);
}
.download-lead {
  max-width: 650px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 16px;
  line-height: 1.82;
}
.download-feature-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 25px;
}
.download-feature-row span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 8px 12px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
}
.download-primary-card {
  max-width: 590px;
  margin-top: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  border: 1px solid rgba(240, 122, 79, 0.3);
  border-radius: 18px;
  padding: 20px;
  background:
    linear-gradient(120deg, rgba(240, 122, 79, 0.13), rgba(255, 255, 255, 0.035)),
    rgba(255, 255, 255, 0.035);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
}
.download-primary-card h2 {
  margin-top: 6px;
  font-size: 20px;
  letter-spacing: -0.03em;
}
.download-primary-card p:last-child {
  margin-top: 7px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}
.download-primary-button,
.download-platform-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border: 0;
  border-radius: 11px;
  padding: 0 17px;
  background: var(--dl-accent);
  color: #160b07;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}
.download-primary-button:hover,
.download-platform-button:hover {
  background: #ff936d;
}
.download-primary-button:disabled,
.download-platform-button.is-disabled {
  cursor: default;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.42);
}
.download-spin {
  animation: download-spin 0.9s linear infinite;
}
@keyframes download-spin {
  to { transform: rotate(360deg); }
}
.download-visual {
  position: relative;
  min-height: 470px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.download-visual-orbit {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 50%;
  transform: rotate(-18deg);
}
.download-visual-orbit-a {
  width: 500px;
  height: 300px;
}
.download-visual-orbit-b {
  width: 420px;
  height: 230px;
  transform: rotate(30deg);
}
.download-window {
  position: relative;
  z-index: 2;
  width: min(430px, 100%);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 20px;
  background: #141519;
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.48), 0 0 80px rgba(240, 122, 79, 0.09);
  transform: perspective(1000px) rotateY(-8deg) rotateX(3deg);
}
.download-window-bar {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.download-window-bar span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
}
.download-window-bar strong {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.38);
  font-size: 9px;
  letter-spacing: 0.13em;
}
.download-window-body {
  min-height: 320px;
  display: flex;
}
.download-window-rail {
  width: 54px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 18px;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
}
.download-window-rail i {
  width: 25px;
  height: 25px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}
.download-window-rail i:first-child {
  border-color: rgba(240, 122, 79, 0.6);
  background: rgba(240, 122, 79, 0.16);
}
.download-window-canvas {
  position: relative;
  flex: 1;
  overflow: hidden;
  background-image: radial-gradient(rgba(255, 255, 255, 0.11) 0.7px, transparent 0.7px);
  background-size: 17px 17px;
}
.download-window-tile {
  position: absolute;
  border-radius: 10px;
  box-shadow: 0 14px 35px rgba(0, 0, 0, 0.3);
}
.tile-a {
  width: 150px;
  height: 108px;
  left: 42px;
  top: 65px;
  background: linear-gradient(135deg, #b94d31, #e98c55 56%, #3c2534);
}
.tile-b {
  width: 128px;
  height: 154px;
  right: 34px;
  top: 42px;
  background: linear-gradient(145deg, #182b4d, #4a77b7 55%, #b5d4f1);
}
.tile-c {
  width: 175px;
  height: 78px;
  left: 88px;
  bottom: 37px;
  background: linear-gradient(90deg, #1a2028, #768d72 50%, #d0b67c);
}
.download-window-cursor {
  position: absolute;
  left: 53%;
  top: 48%;
  width: 17px;
  height: 24px;
  background: #fff;
  clip-path: polygon(0 0, 100% 65%, 58% 70%, 42% 100%);
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.5));
}
.download-visual-chip {
  position: absolute;
  z-index: 3;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 9px;
  padding: 9px 12px;
  background: rgba(20, 21, 25, 0.86);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  backdrop-filter: blur(14px);
}
.chip-a { top: 56px; left: 18px; }
.chip-b { right: 2px; top: 225px; }
.chip-c { left: 34px; bottom: 42px; }
.download-section {
  padding-top: 80px;
}
.download-section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 25px;
}
.download-section-heading h2,
.download-info-card h2 {
  margin-top: 8px;
  font-size: 32px;
  letter-spacing: -0.045em;
}
.download-section-heading > p {
  max-width: 430px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 13px;
  line-height: 1.7;
  text-align: right;
}
.download-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.download-platform-card,
.download-info-card,
.download-update-note {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 17px;
  background: rgba(255, 255, 255, 0.035);
}
.download-platform-card {
  padding: 22px;
  transition: 180ms ease;
}
.download-platform-card:hover,
.download-platform-card.is-recommended {
  border-color: rgba(240, 122, 79, 0.42);
  background: rgba(240, 122, 79, 0.055);
  transform: translateY(-3px);
}
.download-platform-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.download-platform-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
}
.platform-windows_x64 { background: linear-gradient(135deg, #1675d1, #55b9ff); }
.platform-macos_arm64 { background: linear-gradient(135deg, #5a5f68, #22252b); }
.platform-macos_x64 { background: linear-gradient(135deg, #77716a, #3f3b38); }
.download-recommended {
  border-radius: 999px;
  padding: 5px 9px;
  background: rgba(240, 122, 79, 0.16);
  color: #ffab89;
  font-size: 10px;
  font-weight: 700;
}
.download-platform-card h3 {
  margin-top: 22px;
  font-size: 19px;
  letter-spacing: -0.03em;
}
.download-platform-card > p {
  min-height: 40px;
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  line-height: 1.6;
}
.download-platform-button {
  width: 100%;
  margin-top: 22px;
}
.download-info-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
  gap: 16px;
  padding-top: 58px;
}
.download-info-card {
  padding: 28px;
}
.download-release-notes {
  margin-top: 22px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.download-muted {
  margin-top: 20px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}
.download-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.42);
  font-size: 12px;
}
.download-meta-row strong {
  color: rgba(255, 255, 255, 0.82);
}
.download-system-card ul {
  display: grid;
  gap: 12px;
  margin-top: 21px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.65;
}
.download-system-card li::marker {
  color: var(--dl-accent);
}
.download-update-note {
  margin-top: 16px;
  display: flex;
  gap: 15px;
  padding: 22px 25px;
  color: rgba(255, 255, 255, 0.65);
}
.download-update-note strong {
  color: #fff;
  font-size: 13px;
}
.download-update-note p {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
}
.download-footer {
  min-height: 92px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 54px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.38);
  font-size: 12px;
}
.download-footer div {
  display: flex;
  gap: 20px;
}
.download-footer a:hover {
  color: #fff;
}
@media (max-width: 960px) {
  .download-hero {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .download-visual {
    min-height: 390px;
  }
  .download-links {
    display: none;
  }
  .download-grid {
    grid-template-columns: 1fr;
  }
  .download-info-grid {
    grid-template-columns: 1fr;
  }
  .download-section-heading {
    align-items: start;
    flex-direction: column;
  }
  .download-section-heading > p {
    text-align: left;
  }
}
@media (max-width: 620px) {
  .download-nav,
  .download-main,
  .download-footer {
    width: min(100% - 24px, 1180px);
  }
  .download-nav {
    min-height: 68px;
  }
  .download-links,
  .download-nav-actions > :first-child {
    display: none;
  }
  .download-main {
    padding-top: 44px;
  }
  .download-hero h1 {
    font-size: 46px;
  }
  .download-primary-card {
    align-items: stretch;
    flex-direction: column;
  }
  .download-primary-button {
    width: 100%;
  }
  .download-visual {
    min-height: 315px;
  }
  .download-window {
    transform: none;
  }
  .download-visual-chip {
    display: none;
  }
  .download-section {
    padding-top: 56px;
  }
  .download-section-heading h2,
  .download-info-card h2 {
    font-size: 27px;
  }
  .download-footer {
    align-items: start;
    flex-direction: column;
    padding: 24px 0;
  }
}
</style>
