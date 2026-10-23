import type { RouteRecordRaw } from 'vue-router'

export const publicCustomFeatureRoutes: RouteRecordRaw[] = []

export const userCustomFeatureRoutesAfterKeys: RouteRecordRaw[] = [
  {
    path: '/playground',
    name: 'Playground',
    component: () => import('@/views/user/PlaygroundView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Playground',
      titleKey: 'playground.title',
      descriptionKey: 'playground.description'
    }
  },
  {
    path: '/image-studio',
    name: 'ImageStudio',
    component: () => import('@/features/image-studio/ImageStudioView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Image Studio',
      keepAlive: true,
      immersive: true,
    }
  },
  {
    path: '/canvas',
    name: 'CanvasProjects',
    component: () => import('@/features/infinite-canvas/CanvasRoutePlaceholder.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Infinite Canvas',
      titleKey: 'nav.canvas',
      immersive: true,
    }
  },
  {
    path: '/video-studio',
    name: 'VideoStudio',
    component: () => import('@/features/video-studio/VideoStudioView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Video Studio',
      titleKey: 'videoStudio.title',
      descriptionKey: 'videoStudio.description',
      immersive: true,
    }
  },
  {
    path: '/video-inspiration',
    name: 'VideoInspiration',
    component: () => import('@/features/video-studio/VideoInspirationView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Video Inspiration',
      titleKey: 'videoInspiration.title',
      descriptionKey: 'videoInspiration.description',
      immersive: true,
    }
  },
  {
    path: '/image-inspiration',
    name: 'ImageInspiration',
    component: () => import('@/features/image-studio/ImageInspirationView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Image Inspiration',
      titleKey: 'imageInspiration.title',
      descriptionKey: 'imageInspiration.description',
      immersive: true,
    }
  },
  {
    path: '/video-works',
    name: 'VideoWorks',
    component: () => import('@/features/video-studio/VideoWorksView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'My Video Works',
      titleKey: 'videoWorks.title',
      descriptionKey: 'videoWorks.description',
      immersive: true,
    }
  }
]

export const userCustomFeatureRoutesAfterRedeem: RouteRecordRaw[] = [
  {
    path: '/lottery',
    name: 'Lottery',
    component: () => import('@/views/user/LotteryView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Lottery',
      titleKey: 'lottery.title',
      descriptionKey: 'lottery.description'
    }
  }
]

export const userCustomFeatureRoutesAfterAvailableChannels: RouteRecordRaw[] = [
  {
    path: '/manual',
    name: 'UserManual',
    redirect: {
      path: '/image-studio',
      query: { openManual: '1' }
    },
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'User Manual',
      titleKey: 'manual.title',
      descriptionKey: 'manual.description'
    }
  },
  {
    path: '/manual/:platform',
    redirect: {
      path: '/image-studio',
      query: { openManual: '1' }
    }
  },
  {
    path: '/docs/api',
    alias: ['/docs'],
    name: 'ApiDocs',
    component: () => import('@/views/user/ApiDocsView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'API Docs',
      titleKey: 'nav.apiDocs'
    }
  },
  {
    path: '/models',
    name: 'UserModels',
    redirect: {
      path: '/image-studio',
      query: { openModelPlaza: '1' }
    },
    meta: {
      requiresAuth: true,
      requiresAdmin: false,
      title: 'Models',
      titleKey: 'models.title',
      descriptionKey: 'models.description'
    }
  }
]

export const adminCustomFeatureRoutesAfterAnnouncements: RouteRecordRaw[] = [
  {
    path: '/admin/lottery',
    name: 'AdminLottery',
    component: () => import('@/views/admin/LotteryView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: 'Lottery Management',
      titleKey: 'admin.lottery.title',
      descriptionKey: 'admin.lottery.description'
    }
  }
]

export const adminCustomFeatureRoutesAfterSettings: RouteRecordRaw[] = [
  {
    path: '/admin/upstream-monitor',
    name: 'AdminUpstreamMonitor',
    component: () => import('@/views/admin/UpstreamMonitorView.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: 'Upstream Monitor',
      titleKey: 'admin.upstreamMonitor.title',
      descriptionKey: 'admin.upstreamMonitor.description'
    }
  }
]
