import type { DriveStep } from 'driver.js'
import { DEFAULT_SITE_NAME } from '@/constants/brand'

type Translate = (key: string, params?: Record<string, unknown>) => string

function creativeTourSteps(siteName: string): DriveStep[] {
  return [
    {
      popover: {
        title: `欢迎使用 ${siteName}`,
        description: '这里把图片生成、视频生成、灵感参考和作品管理放在同一个创作工作台里。',
        align: 'center',
        nextBtnText: '开始了解',
      },
    },
    {
      element: '[data-tour="nav-image-studio"]',
      popover: {
        title: '生图工作台',
        description: '输入提示词、选择模型和尺寸，也可以上传参考图进行图生图。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tour="nav-video-studio"]',
      popover: {
        title: '视频工作台',
        description: '描述镜头运动和画面节奏，设置时长、画幅、画质与参考素材。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tour="nav-image-inspiration"]',
      popover: {
        title: '图片灵感',
        description: '浏览图片案例和完整提示词，找到合适的构图、光线与风格后一键带入工作台。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tour="nav-video-inspiration"]',
      popover: {
        title: '视频灵感',
        description: '这里集中展示视频提示词和镜头模板，适合寻找运镜、节奏和场景创意。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tour="nav-video-works"]',
      popover: {
        title: '我的作品',
        description: '生成后的图片和视频可以保存到这里，长期作品会进入对象存储。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tour="header-api-keys"]',
      popover: {
        title: 'API 密钥',
        description: '在弹窗里创建密钥、切换模型分组，并设置额度、有效期和调用限额。',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-user-menu"]',
      popover: {
        title: '个人菜单',
        description: '个人资料、API 密钥和新手引导都在这里打开，不会离开当前工作台。',
        side: 'bottom',
        align: 'end',
        showButtons: ['previous', 'close'],
      },
    },
  ]
}

export const getAdminSteps = (
  _t: Translate,
  _isSimpleMode = false,
  siteName = DEFAULT_SITE_NAME,
): DriveStep[] => creativeTourSteps(siteName)

export const getUserSteps = (
  _t: Translate,
  siteName = DEFAULT_SITE_NAME,
): DriveStep[] => creativeTourSteps(siteName)
