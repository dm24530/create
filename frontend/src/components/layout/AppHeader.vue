<template>
  <header class="glass sticky top-0 z-30 border-b border-gray-200/50 dark:border-dark-700/50">
    <div class="relative flex h-14 items-center justify-between gap-2 px-2 sm:px-4 md:px-6">
      <!-- Left: Mobile Menu Toggle + Page Title -->
      <div v-if="!compact" class="flex shrink-0 items-center gap-2 sm:gap-4">
        <button
          @click="toggleMobileSidebar"
          class="btn-ghost btn-icon lg:hidden"
          :aria-label="t('common.toggleMenu')"
        >
          <Icon name="menu" size="md" />
        </button>

        <div class="hidden lg:block">
          <h1 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ pageTitle }}
          </h1>
          <p v-if="pageDescription" class="text-xs text-gray-500 dark:text-dark-400">
            {{ pageDescription }}
          </p>
        </div>
      </div>

      <!-- Inline studio navigation on wide screens -->
      <div
        v-if="$slots.nav"
        class="app-header__nav hidden min-w-0 flex-1 justify-center px-2 xl:flex"
      >
        <slot name="nav" />
      </div>

      <!-- Right: Announcements + Docs + Language + Subscriptions + Balance + User Dropdown -->
      <div class="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-0.5 sm:gap-1.5">
        <!-- Announcement Bell -->
        <AnnouncementBell v-if="user" />

        <!-- Desktop local-save settings -->
        <button
          v-if="user && desktopBridgeAvailable"
          type="button"
          title="本地保存设置"
          aria-label="本地保存设置"
          class="hidden items-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white sm:flex"
          @click="openDesktopSettings"
        >
          <Icon name="inbox" size="sm" />
        </button>

        <!-- API Docs Link -->
        <a
          v-if="user"
          :href="apiDocsUrl"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('nav.apiDocs')"
          :aria-label="t('nav.apiDocs')"
          class="hidden items-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white sm:flex"
        >
          <Icon name="book" size="sm" />
        </a>

        <button
          v-if="user"
          type="button"
          data-tour="header-api-keys"
          :title="t('nav.apiKeys')"
          :aria-label="t('nav.apiKeys')"
          class="hidden items-center gap-1 rounded-md px-2 py-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white sm:flex"
          @click="openApiKeyModal"
        >
          <Icon name="key" size="sm" />
        </button>

        <button
          v-if="user"
          type="button"
          :title="t('nav.usage')"
          :aria-label="t('nav.usage')"
          class="hidden items-center gap-1 rounded-md px-2 py-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white sm:flex"
          @click="usageModalOpen = true"
        >
          <Icon name="chart" size="sm" />
        </button>

        <!-- Model Plaza Entry (icon only below sm) -->
        <button
          v-if="user"
          type="button"
          :title="t('nav.modelPlaza')"
          :aria-label="t('nav.modelPlaza')"
          class="flex items-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white"
          @click="modelPlazaModalOpen = true"
        >
          <Icon name="grid" size="sm" />
        </button>

        <!-- Theme Toggle -->
        <button
          type="button"
          data-testid="header-theme-toggle"
          class="theme-toggle flex items-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white"
          :title="isDark ? t('nav.lightMode') : t('nav.darkMode')"
          :aria-label="isDark ? t('nav.lightMode') : t('nav.darkMode')"
          :aria-pressed="isDark"
          @click="toggleTheme"
        >
          <Icon
            :name="isDark ? 'sun' : 'moon'"
            size="sm"
            :class="isDark ? 'text-amber-500' : ''"
          />
        </button>

        <!-- Language Switcher -->
        <LocaleSwitcher compact />

        <!-- Subscription Progress (for users with active subscriptions; not mounted at all when the feature is off) -->
        <SubscriptionProgressMini v-if="user && subscriptionFeatureEnabled" />

        <!-- Balance Display -->
        <button
          v-if="user"
          type="button"
          title="充值"
          aria-label="充值"
          class="group relative hidden items-center gap-1.5 rounded-lg bg-primary-50 px-2 py-1 dark:bg-primary-900/20 sm:flex"
          @click="openRechargeModal"
        >
          <svg
            class="h-3.5 w-3.5 text-primary-600 dark:text-primary-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
            />
          </svg>
          <span class="text-xs font-semibold text-primary-700 dark:text-primary-300">
            {{ formatHeaderMoney(availableBalance) }}
          </span>
          <div
            class="pointer-events-none absolute right-0 top-full mt-2 hidden w-56 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg group-hover:block dark:border-dark-700 dark:bg-dark-800"
          >
            <div class="flex items-center justify-between">
              <span class="text-gray-500 dark:text-dark-400">{{ balanceAvailableText }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ formatHeaderMoney(availableBalance) }}</span>
            </div>
            <div class="mt-2 flex items-center justify-between">
              <span class="text-gray-500 dark:text-dark-400">{{ balanceFrozenText }}</span>
              <span class="font-medium text-amber-700 dark:text-amber-200">{{ formatHeaderMoney(frozenBalance) }}</span>
            </div>
            <div class="mt-2 border-t border-gray-100 pt-2 dark:border-dark-700">
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-dark-400">{{ balanceTotalText }}</span>
                <span class="font-semibold text-gray-900 dark:text-white">{{ formatHeaderMoney(totalBalance) }}</span>
              </div>
            </div>
          </div>
        </button>

        <!-- User Dropdown -->
        <div v-if="user" class="relative" ref="dropdownRef">
          <button
            @click="toggleDropdown"
            data-tour="header-user-menu"
            :title="displayName"
            class="flex items-center rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-dark-800"
            :aria-label="t('common.userMenu')"
          >
            <div class="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 text-xs font-medium text-white shadow-sm">
              <img
                v-if="avatarUrl"
                :src="avatarUrl"
                :alt="displayName"
                class="h-full w-full object-cover"
              >
              <span v-else>{{ userInitials }}</span>
            </div>
          </button>

          <!-- Dropdown Menu -->
          <transition name="dropdown">
            <div v-if="dropdownOpen" class="dropdown right-0 mt-2 w-56">
              <!-- User Info -->
              <div class="border-b border-gray-100 px-4 py-3 dark:border-dark-700">
                <div class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ displayName }}
                </div>
                <div class="text-xs text-gray-500 dark:text-dark-400">{{ user.email }}</div>
              </div>

              <!-- Balance (mobile only) -->
              <div class="border-b border-gray-100 px-4 py-2 dark:border-dark-700 sm:hidden">
                <div class="text-xs text-gray-500 dark:text-dark-400">
                  {{ t('common.balance') }}
                </div>
                <div class="text-sm font-semibold text-primary-600 dark:text-primary-400">
                  {{ formatHeaderMoney(availableBalance) }}
                </div>
                <div v-if="frozenBalance > 0" class="mt-1 text-xs text-amber-600 dark:text-amber-300">
                  {{ balanceFrozenText }} {{ formatHeaderMoney(frozenBalance) }}
                </div>
              </div>

              <div class="py-1">
                <button type="button" @click="openProfileModal" class="dropdown-item w-full">
                  <Icon name="user" size="sm" />
                  {{ t('nav.profile') }}
                </button>

                <button type="button" @click="openApiKeyModal" class="dropdown-item w-full">
                  <Icon name="key" size="sm" />
                  {{ t('nav.apiKeys') }}
                </button>

              </div>

              <!-- Contact Support (only show if configured) -->
              <div
                v-if="contactInfo"
                class="border-t border-gray-100 px-4 py-2.5 dark:border-dark-700"
              >
                <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <svg
                    class="h-3.5 w-3.5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
                    />
                  </svg>
                  <span>{{ t('common.contactSupport') }}:</span>
                  <span class="font-medium text-gray-700 dark:text-gray-300">{{
                    contactInfo
                  }}</span>
                </div>
              </div>

              <div v-if="showOnboardingButton" class="border-t border-gray-100 py-1 dark:border-dark-700">
                <button @click="handleReplayGuide" class="dropdown-item w-full">
                  <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 14a1 1 0 110 2 1 1 0 010-2zm1.07-7.75c0-.6-.49-1.25-1.32-1.25-.7 0-1.22.4-1.43 1.02a1 1 0 11-1.9-.62A3.41 3.41 0 0111.8 5c2.02 0 3.25 1.4 3.25 2.9 0 2-1.83 2.55-2.43 3.12-.43.4-.47.75-.47 1.23a1 1 0 01-2 0c0-1 .16-1.82 1.1-2.7.69-.64 1.82-1.05 1.82-2.06z"
                    />
                  </svg>
                  {{ $t('onboarding.restartTour') }}
                </button>
              </div>

              <div class="border-t border-gray-100 py-1 dark:border-dark-700">
                <button
                  @click="handleLogout"
                  class="dropdown-item w-full text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                    />
                  </svg>
                  {{ t('nav.logout') }}
                </button>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </div>
    <ApiKeyQuickModal :show="apiKeyModalOpen" @close="apiKeyModalOpen = false" />
    <UsageQuickModal :show="usageModalOpen" @close="usageModalOpen = false" />
    <ModelPlazaQuickModal :show="modelPlazaModalOpen" @close="modelPlazaModalOpen = false" />
    <ProfileQuickModal :show="profileModalOpen" @close="profileModalOpen = false" />
    <ManualQuickModal :show="manualModalOpen" @close="manualModalOpen = false" />
    <RechargeQuickModal
      :show="rechargeModalOpen"
      :initial-tab="rechargeInitialTab"
      @close="rechargeModalOpen = false"
    />
  </header>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore, useAuthStore, useOnboardingStore } from '@/stores'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import LocaleSwitcher from '@/components/common/LocaleSwitcher.vue'
import SubscriptionProgressMini from '@/components/common/SubscriptionProgressMini.vue'
import AnnouncementBell from '@/components/common/AnnouncementBell.vue'
import ApiKeyQuickModal from '@/components/keys/ApiKeyQuickModal.vue'
import UsageQuickModal from '@/components/usage/UsageQuickModal.vue'
import ModelPlazaQuickModal from '@/components/modelPlaza/ModelPlazaQuickModal.vue'
import ProfileQuickModal from '@/components/user/ProfileQuickModal.vue'
import RechargeQuickModal from '@/components/payment/RechargeQuickModal.vue'
import ManualQuickModal from '@/components/docs/ManualQuickModal.vue'
import Icon from '@/components/icons/Icon.vue'
import { sanitizeUrl } from '@/utils/url'
import { FeatureFlags, isFeatureFlagEnabled } from '@/utils/featureFlags'
import { resolveRouteMetaKeys } from '@/router/title'
import { resolveSiteBillingMode } from '@/utils/siteBillingMode'
import { useTheme } from '@/composables/useTheme'
import { getDesktopBridge, openDesktopSaveSettings } from '@/utils/desktopBridge'

withDefaults(defineProps<{
  compact?: boolean
}>(), {
  compact: false,
})

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const apiKeyModalOpen = ref(false)
const usageModalOpen = ref(false)
const modelPlazaModalOpen = ref(false)
const profileModalOpen = ref(false)
const manualModalOpen = ref(false)
const rechargeModalOpen = ref(false)
const rechargeInitialTab = ref<'recharge' | 'redeem'>('recharge')
const appStore = useAppStore()
const authStore = useAuthStore()
const adminSettingsStore = useAdminSettingsStore()
const onboardingStore = useOnboardingStore()
const { isDark, toggleTheme } = useTheme()

const user = computed(() => authStore.user)
const dropdownOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const contactInfo = computed(() => appStore.contactInfo)
const desktopBridgeAvailable = Boolean(getDesktopBridge())
const docUrl = computed(() => sanitizeUrl(appStore.docUrl))
const apiDocsUrl = computed(() => {
  if (docUrl.value) return docUrl.value
  if (typeof window === 'undefined') return '/docs/api'
  return new URL('/docs/api', window.location.origin).toString()
})
const avatarUrl = computed(() => user.value?.avatar_url?.trim() || '')
const availableBalance = computed(() => Number(user.value?.balance || 0))
const frozenBalance = computed(() => Number(user.value?.frozen_balance || 0))
const totalBalance = computed(() => availableBalance.value + frozenBalance.value)
const balanceAvailableText = computed(() => t('common.availableBalance') === 'common.availableBalance' ? '可用余额' : t('common.availableBalance'))
const balanceFrozenText = computed(() => t('common.frozenBalance') === 'common.frozenBalance' ? '冻结金额' : t('common.frozenBalance'))
const balanceTotalText = computed(() => t('common.totalBalance') === 'common.totalBalance' ? '总余额' : t('common.totalBalance'))

// 只在标准模式的管理员下显示新手引导按钮
const showOnboardingButton = computed(() => {
  return !authStore.isSimpleMode && user.value?.role === 'admin'
})

const userInitials = computed(() => {
  if (!user.value) return ''
  // Prefer username, fallback to email
  if (user.value.username) {
    return user.value.username.substring(0, 2).toUpperCase()
  }
  if (user.value.email) {
    // Get the part before @ and take first 2 chars
    const localPart = user.value.email.split('@')[0]
    return localPart.substring(0, 2).toUpperCase()
  }
  return ''
})

const displayName = computed(() => {
  if (!user.value) return ''
  return user.value.username || user.value.email?.split('@')[0] || ''
})

// 订阅功能关闭时不挂载顶栏订阅徽章（组件 onMounted 会拉取订阅接口）。
const subscriptionFeatureEnabled = computed(() => isFeatureFlagEnabled(FeatureFlags.subscription))

watch(
  [
    () => route.query.openApiKeys,
    () => route.query.openModelPlaza,
    () => route.query.openUsage,
    () => route.query.openProfile,
    () => route.query.openManual,
    () => route.query.openRecharge,
    () => route.query.rechargeTab,
  ],
  ([openApiKeys, openModelPlaza, openUsage, openProfile, openManual, openRecharge, rechargeTab]) => {
    if (openApiKeys === '1') {
      apiKeyModalOpen.value = true
      clearModalQuery('openApiKeys')
    }
    if (openModelPlaza === '1') {
      modelPlazaModalOpen.value = true
      clearModalQuery('openModelPlaza')
    }
    if (openUsage === '1') {
      usageModalOpen.value = true
      clearModalQuery('openUsage')
    }
    if (openProfile === '1') {
      profileModalOpen.value = true
      clearModalQuery('openProfile')
    }
    if (openManual === '1') {
      manualModalOpen.value = true
      clearModalQuery('openManual')
    }
    if (openRecharge === '1') {
      rechargeInitialTab.value = rechargeTab === 'redeem' ? 'redeem' : 'recharge'
      rechargeModalOpen.value = true
      clearModalQueries('openRecharge', 'rechargeTab')
    }
  },
  { immediate: true },
)

function clearModalQuery(
  key: 'openApiKeys' | 'openModelPlaza' | 'openUsage' | 'openProfile' | 'openManual' | 'openRecharge' | 'rechargeTab',
) {
  clearModalQueries(key)
}

function clearModalQueries(
  ...keys: Array<'openApiKeys' | 'openModelPlaza' | 'openUsage' | 'openProfile' | 'openManual' | 'openRecharge' | 'rechargeTab'>
) {
  const query = { ...route.query }
  for (const key of keys) delete query[key]
  void router.replace({ path: route.path, query })
}

// /purchase 的标题/描述随站点计费模式切换，与 document.title 共用同一解析。
const routeMetaKeys = computed(() => resolveRouteMetaKeys(route, {
  billingMode: resolveSiteBillingMode(appStore.cachedPublicSettings),
}))

const pageTitle = computed(() => {
  // For custom pages, use the menu item's label instead of generic "自定义页面"
  if (route.name === 'CustomPage') {
    const id = route.params.id as string
    const publicItems = appStore.cachedPublicSettings?.custom_menu_items ?? []
    const menuItem = publicItems.find((item) => item.id === id)
      ?? (authStore.isAdmin ? adminSettingsStore.customMenuItems.find((item) => item.id === id) : undefined)
    if (menuItem?.label) return menuItem.label
  }
  const titleKey = routeMetaKeys.value.titleKey
  if (titleKey) {
    return t(titleKey)
  }
  return (route.meta.title as string) || ''
})

const pageDescription = computed(() => {
  const descKey = routeMetaKeys.value.descriptionKey
  if (descKey) {
    return t(descKey)
  }
  return (route.meta.description as string) || ''
})

function toggleMobileSidebar() {
  appStore.toggleMobileSidebar()
}

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
}

function closeDropdown() {
  dropdownOpen.value = false
}

function openApiKeyModal() {
  closeDropdown()
  apiKeyModalOpen.value = true
}

async function openDesktopSettings() {
  try {
    await openDesktopSaveSettings()
  } catch (error) {
    console.error('Failed to open desktop save settings:', error)
  }
}

function openProfileModal() {
  closeDropdown()
  profileModalOpen.value = true
}

function openRechargeModal() {
  closeDropdown()
  rechargeInitialTab.value = 'recharge'
  rechargeModalOpen.value = true
}

async function handleLogout() {
  closeDropdown()
  try {
    await authStore.logout()
  } catch (error) {
    // Ignore logout errors - still redirect to login
    console.error('Logout error:', error)
  }
  await router.push('/login')
}

async function handleReplayGuide() {
  closeDropdown()
  if (route.path !== '/image-studio') {
    await router.push('/image-studio')
    await nextTick()
  }
  onboardingStore.replay()
}

function formatHeaderMoney(value: number) {
  if (!Number.isFinite(value)) return '$0.00'
  return `$${value.toFixed(2)}`
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
@media (min-width: 1440px) {
  .app-header__nav {
    position: absolute;
    top: 0;
    left: 50%;
    height: 100%;
    flex: none;
    align-items: center;
    transform: translateX(-50%);
  }
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}
</style>
