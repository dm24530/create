export default {
  batchImageGuide: {
    title: '图片批量生成',
    description: '一次提交多条提示词，任务完成后可统一下载图片结果'
  },
  // Home Page
  home: {
    landing: {
      nav: {
        image: '图片生成',
        video: '视频生成',
        canvas: '无限画布',
        inspiration: '视频灵感',
        works: '作品库',
        models: '模型',
        docs: '使用指南'
      },
      workspace: '进入工作台',
      eyebrow: '属于你的 AI 创作场',
      titleTop: '让灵感，',
      titleAccent: '成图，也成片。',
      description: '从脑海中的一瞬，到眼前的惊艳。用 AI 生成图片与视频，让想象自由发生。',
      startImage: '开始生图',
      createVideo: '创作视频',
      explore: '探索无限可能',
      slides: {
        nebula: '星云深处',
        desert: '荒漠电影感',
        stars: '银河之下'
      },
      galleryTitle: '想象，不止于想象。',
      galleryLink: '进入图片工作台',
      gallery: {
        items: {
          flower: '微观花园',
          desert: '公路尽头',
          aurora: '极光边界',
          nature: '深海来客',
          architecture: '几何边界',
          rings: '星环之下',
          city: '霓虹街巷'
        }
      },
      filmTitle: '不止一帧。',
      filmAccent: '让故事发生。',
      filmDescription: '写下场景、动作与运镜，或带上一张参考图。用 Seedance 和 Grok 把静态画面变成有时间、节奏和声音的短片。',
      filmPoints: {
        text: '文字生成视频',
        frame: '首尾帧衔接',
        multimodal: '多模态参考'
      },
      filmCta: '进入视频工作台',
      notebookTitle: '好镜头，从一个好灵感开始。',
      notebookLink: '全部灵感模板',
      notebookDescription: '从场景、镜头和节奏开始，挑选一个模板，再把它改成你自己的故事。',
      notebook: {
        items: {
          product: {
            title: '光影里的产品镜头',
            meta: '产品广告 / 分镜模板'
          },
          facade: {
            title: '玻璃幕墙的节奏',
            meta: '建筑 / 结构模板'
          },
          botanical: {
            title: '花瓣与微距呼吸',
            meta: '自然 / 细节模板'
          }
        }
      },
      principlesTitle: '从一张图，到一段完整叙事。',
      principles: {
        one: {
          title: '图片与视频共用作品库',
          description: '生成结果自动进入统一作品库，临时内容保留七日，重要作品可以长期保存。'
        },
        two: {
          title: '调度与计费在同一条链路',
          description: '账号池自动切换，按实际用量计费，图片、视频和文本使用同一套额度体系。'
        },
        three: {
          title: '兼容你的创作工具',
          description: '浏览器工作台和 OpenAI、Anthropic、Gemini、Seedance 协议共用同一组 API Key。'
        }
      },
      ctaTitle: '把下一个想法，变成作品。',
      ctaDescription: '登录后即可进入图片与视频工作台，使用平台额度或你自己的上游密钥开始创作。',
      ctaButton: '免费开始创作',
      goWorkspace: '进入工作台'
    },
    publicModels: {
      eyebrow: '公开模型',
      title: '可用模型与价格',
      groups: '个分组',
      publicOnly: '仅展示公开分组',
      priceHint: '价格为当前公开分组的价格，实际计费以调用时为准。'
    },
    seoDescription: 'Create 是一个 AI 视频与图片生成平台，支持 AI 视频生成、AI 图片生成与作品管理。',
    viewOnGithub: '在 GitHub 上查看',
    viewDocs: '查看文档',
    docs: '文档',
    switchToLight: '切换到浅色模式',
    switchToDark: '切换到深色模式',
    dashboard: '控制台',
    login: '登录',
    getStarted: '立即开始',
    goToDashboard: '进入控制台',
    // 新增：面向用户的价值主张
    heroSubtitle: '一个密钥，畅用多个 AI 模型',
    heroDescription: '无需管理多个订阅账号，一站式接入 Claude、GPT、Gemini 等主流 AI 服务',
    tags: {
      subscriptionToApi: '文生视频',
      stickySession: '参考图续写',
      realtimeBilling: '按量计费'
    },
    // 用户痛点区块
    painPoints: {
      title: '你是否也遇到这些问题？',
      items: {
        expensive: {
          title: '订阅费用高',
          desc: '每个 AI 服务都要单独订阅，每月支出越来越多'
        },
        complex: {
          title: '多账号难管理',
          desc: '不同平台的账号、密钥分散各处，管理起来很麻烦'
        },
        unstable: {
          title: '服务不稳定',
          desc: '单一账号容易触发限制，影响正常使用'
        },
        noControl: {
          title: '用量无法控制',
          desc: '不知道钱花在哪了，也无法限制团队成员的使用'
        }
      }
    },
    // 解决方案区块
    solutions: {
      title: '我们帮你解决',
      subtitle: '简单三步，开始省心使用 AI'
    },
    features: {
      unifiedGateway: '一站式生成',
      unifiedGatewayDesc: '视频和图片在同一个工作台完成，提示词、参考素材和参数一处管理，不用来回切换工具。',
      multiAccount: '稳定出片',
      multiAccountDesc: '多个上游账号自动调度，遇到限流自动切换重试，长任务不容易半途失败。',
      balanceQuota: '用多少付多少',
      balanceQuotaDesc: '按实际生成量计费，支持设置配额上限，团队用量一目了然。'
    },
    // 优势对比
    comparison: {
      title: '为什么选择我们？',
      headers: {
        feature: '对比项',
        official: '官方订阅',
        us: '本平台'
      },
      items: {
        pricing: {
          feature: '付费方式',
          official: '固定月费，用不完也付',
          us: '按量付费，用多少付多少'
        },
        models: {
          feature: '模型选择',
          official: '单一服务商',
          us: '多模型随意切换'
        },
        management: {
          feature: '账号管理',
          official: '每个服务单独管理',
          us: '统一密钥，一站管理'
        },
        stability: {
          feature: '服务稳定性',
          official: '单账号易触发限制',
          us: '多账号池，自动切换'
        },
        control: {
          feature: '用量控制',
          official: '无法限制',
          us: '可设配额、查明细'
        }
      }
    },
    providers: {
      title: '已支持的 AI 模型',
      description: '视频与图片生成所需的模型，持续接入中',
      supported: '已支持',
      soon: '即将推出',
      gpt: 'GPT 生图',
      gemini: 'Gemini 生图',
      grok: 'Grok 生图',
      more: '更多'
    },
    // CTA 区块
    cta: {
      title: '准备好开始了吗？',
      description: '注册即可获得免费试用额度，体验一站式 AI 服务',
      button: '免费注册'
    },
    footer: {
      allRightsReserved: '保留所有权利。'
    }
  },

  // Key Usage Query Page
  keyUsage: {
    title: 'API Key 用量查询',
    subtitle: '输入您的 API Key 以查看实时消费金额与使用状态',
    placeholder: 'sk-ant-mirror-xxxxxxxxxxxx',
    query: '查询',
    querying: '查询中...',
    privacyNote: '您的 Key 仅在浏览器本地处理，不会被存储',
    dateRange: '统计范围:',
    dateRangeToday: '今日',
    dateRange7d: '7 天',
    dateRange30d: '30 天',
    dateRange90d: '90 天',
    dateRangeCustom: '自定义',
    apply: '应用',
    used: '已使用',
    detailInfo: '详细信息',
    tokenStats: 'Token 统计',
    dailyDetail: '按日明细',
    modelStats: '模型用量统计',
    // Table headers
    date: '日期',
    model: '模型',
    requests: '请求数',
    inputTokens: '输入 Tokens',
    outputTokens: '输出 Tokens',
    cacheCreationTokens: '缓存创建',
    cacheReadTokens: '缓存读取',
    cacheWriteTokens: '缓存写入',
    totalTokens: '总 Tokens',
    cost: '费用',
    // Status
    quotaMode: 'Key 限额模式',
    walletBalance: '钱包余额',
    // Ring card titles
    totalQuota: '总额度',
    limit5h: '5 小时限额',
    limitDaily: '日限额',
    limit7d: '7 天限额',
    limitWeekly: '周限额',
    limitMonthly: '月限额',
    // Detail rows
    remainingQuota: '剩余额度',
    expiresAt: '过期时间',
    todayExpires: '(今日到期)',
    daysLeft: '({days} 天)',
    usedQuota: '已用额度',
    resetNow: '即将重置',
    subscriptionType: '订阅类型',
    billingType: '计费方式',
    subscriptionExpires: '订阅到期',
    // Usage stat cells
    todayRequests: '今日请求',
    todayInputTokens: '今日输入',
    todayOutputTokens: '今日输出',
    todayTokens: '今日 Tokens',
    todayCacheCreation: '今日缓存创建',
    todayCacheRead: '今日缓存读取',
    todayCost: '今日费用',
    rpmTpm: 'RPM / TPM',
    totalRequests: '累计请求',
    totalInputTokens: '累计输入',
    totalOutputTokens: '累计输出',
    totalTokensLabel: '累计 Tokens',
    totalCacheCreation: '累计缓存创建',
    totalCacheRead: '累计缓存读取',
    totalCost: '累计费用',
    avgDuration: '平均耗时',
    // Messages
    enterApiKey: '请输入 API Key',
    querySuccess: '查询成功',
    queryFailed: '查询失败',
    queryFailedRetry: '查询失败，请稍后重试',
    noDailyUsage: '暂无按日用量数据',
  },

  // Setup Wizard
  setup: {
    title: '{siteName} 安装向导',
    description: '配置您的 {siteName} 实例',
    database: {
      title: '数据库配置',
      description: '连接到您的 PostgreSQL 数据库',
      host: '主机',
      port: '端口',
      username: '用户名',
      password: '密码',
      databaseName: '数据库名称',
      sslMode: 'SSL 模式',
      passwordPlaceholder: '密码',
      ssl: {
        disable: '禁用',
        require: '要求',
        verifyCa: '验证 CA',
        verifyFull: '完全验证'
      }
    },
    redis: {
      title: 'Redis 配置',
      description: '连接到您的 Redis 服务器',
      host: '主机',
      port: '端口',
      username: '用户名（可选）',
      password: '密码（可选）',
      database: '数据库',
      usernamePlaceholder: '默认用户留空',
      passwordPlaceholder: '密码',
      enableTls: '启用 TLS',
      enableTlsHint: '连接 Redis 时使用 TLS（公共 CA 证书）'
    },
    admin: {
      title: '管理员账户',
      description: '创建您的管理员账户',
      email: '邮箱',
      password: '密码',
      confirmPassword: '确认密码',
      passwordPlaceholder: '至少 8 个字符',
      confirmPasswordPlaceholder: '确认密码',
      passwordMismatch: '密码不匹配'
    },
    ready: {
      title: '准备安装',
      description: '检查您的配置并完成安装',
      database: '数据库',
      redis: 'Redis',
      adminEmail: '管理员邮箱'
    },
    status: {
      testing: '测试中...',
      success: '连接成功',
      testConnection: '测试连接',
      installing: '安装中...',
      completeInstallation: '完成安装',
      completed: '安装完成！',
      redirecting: '正在跳转到登录页面...',
      restarting: '服务正在重启，请稍候...',
      timeout: '服务重启时间超出预期，请手动刷新页面。'
    }
  },

  // Common
}
