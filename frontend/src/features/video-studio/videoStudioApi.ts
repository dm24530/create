// 视频工作台的接口封装：直接调用用户自己的 API Key，
// 视频生成走异步任务协议，创建 + 轮询 + 取内容三步。
//
// 工作台支持三种视频协议，前端按模型和分组平台选择：
//   - Seedance Video（OpenAI-compatible）：POST /video/generations
//   - Seedance（Ark 任务协议）：POST /contents/generations/tasks
//   - Grok（xAI 视频协议）：POST /videos/generations
// 三种协议的状态查询与内容下载路径不同，统一在这里归一化。

import {
  uploadVideoReferenceAsset,
  type VideoReferenceAssetUpload,
  type VideoReferenceAssetUploadResult,
} from './videoArchiveApi'

export type VideoProvider = 'seedance' | 'seedance_video' | 'grok'

export type VideoTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type VideoMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'first-last-frame'
  | 'reference-images'
  | 'reference-video'
  | 'video-edit'
  | 'video-extension'

export interface VideoReferenceAsset {
  id: number
  kind: 'image' | 'video' | 'audio'
  name: string
  url: string
  role?:
    | 'first_frame'
    | 'last_frame'
    | 'reference_image'
    | 'video_edit'
    | 'video_extension'
  // 本地选择/上传的素材才有字节数，用于前端限制单件与合计体积。
  sizeBytes?: number
}

export interface VideoGenerationParams {
  model: string
  prompt: string
  durationSeconds: number
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  images: VideoReferenceAsset[]
  videos: VideoReferenceAsset[]
  audios: VideoReferenceAsset[]
}

export interface VideoTaskSnapshot {
  status: VideoTaskStatus
  videoUrl: string
  durationSeconds: number
  rawStatus: string
  errorMessage: string
}

export interface VideoGatewayContext {
  baseUrl: string
  apiKey: string
  platform?: string
}

export class VideoTaskRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'VideoTaskRequestError'
    this.status = status
  }
}

export function isRetryableVideoPollingError(error: unknown): boolean {
  if (error instanceof VideoTaskRequestError) {
    return error.status === 408
      || error.status === 425
      || error.status === 429
      || error.status >= 500
  }
  return true
}

// 视频画质档位与后端计费档位一致（480p/720p/1080p）。
export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const

export const VIDEO_ASPECT_RATIOS = [
  { value: '16:9', css: '16 / 9', label: '16:9 横屏' },
  { value: '9:16', css: '9 / 16', label: '9:16 竖屏' },
  { value: '1:1', css: '1 / 1', label: '1:1 方形' },
  { value: '4:3', css: '4 / 3', label: '4:3 经典' },
  { value: '3:4', css: '3 / 4', label: '3:4 竖版' },
  { value: '3:2', css: '3 / 2', label: '3:2 横向' },
  { value: '2:3', css: '2 / 3', label: '2:3 竖向' },
  { value: '21:9', css: '21 / 9', label: '21:9 宽银幕' },
  { value: '5:2', css: '5 / 2', label: '5:2 超宽屏' },
] as const

export interface VideoModelProfile {
  provider: VideoProvider
  minDuration: number
  maxDuration: number
  defaultDuration: number
  resolutions: readonly string[]
  aspectRatios: readonly string[]
  maxImages: number
  maxVideos: number
  supportsAudio: boolean
  modes: readonly VideoMode[]
}

const DOUBAO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
const WAN_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
const DEFAULT_PROFILE: VideoModelProfile = {
  provider: 'seedance',
  minDuration: 1,
  maxDuration: 15,
  defaultDuration: 5,
  resolutions: ['480p', '720p', '1080p'],
  aspectRatios: VIDEO_ASPECT_RATIOS.map((item) => item.value),
  maxImages: 3,
  maxVideos: 1,
  supportsAudio: true,
  modes: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'],
}

const SEEDANCE_MODEL_PROFILES: Record<string, VideoModelProfile> = {
  'grok-imagine-video': {
    provider: 'seedance',
    minDuration: 1,
    maxDuration: 10,
    defaultDuration: 8,
    resolutions: ['480p', '720p'],
    aspectRatios: VIDEO_ASPECT_RATIOS.map((item) => item.value),
    maxImages: 7,
    maxVideos: 1,
    supportsAudio: false,
    modes: ['text-to-video', 'image-to-video', 'reference-images', 'reference-video', 'video-edit', 'video-extension'],
  },
  'grok-imagine-video-1.5': {
    provider: 'seedance',
    minDuration: 1,
    maxDuration: 15,
    defaultDuration: 8,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: VIDEO_ASPECT_RATIOS.map((item) => item.value),
    maxImages: 14,
    maxVideos: 1,
    supportsAudio: true,
    modes: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'],
  },
  'grok-imagine-video-onece': {
    provider: 'seedance',
    minDuration: 1,
    maxDuration: 10,
    defaultDuration: 8,
    resolutions: ['480p', '720p'],
    aspectRatios: VIDEO_ASPECT_RATIOS.map((item) => item.value),
    maxImages: 7,
    maxVideos: 1,
    supportsAudio: false,
    modes: ['text-to-video', 'image-to-video', 'reference-images', 'reference-video', 'video-edit', 'video-extension'],
  },
  'seedance-2.0': {
    provider: 'seedance',
    minDuration: 5,
    maxDuration: 15,
    defaultDuration: 8,
    resolutions: ['480p', '720p'],
    aspectRatios: DOUBAO_ASPECT_RATIOS,
    maxImages: 9,
    maxVideos: 1,
    supportsAudio: true,
    modes: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'],
  },
  'seedance-2.0-fast': {
    provider: 'seedance',
    minDuration: 5,
    maxDuration: 15,
    defaultDuration: 8,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: DOUBAO_ASPECT_RATIOS,
    maxImages: 9,
    maxVideos: 1,
    supportsAudio: true,
    modes: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'],
  },
  'seedance-2.5': {
    provider: 'seedance',
    minDuration: 5,
    maxDuration: 30,
    defaultDuration: 8,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: DOUBAO_ASPECT_RATIOS,
    maxImages: 30,
    maxVideos: 1,
    supportsAudio: true,
    modes: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'],
  },
  'wan3.0-video': {
    provider: 'seedance',
    minDuration: 2,
    maxDuration: 30,
    defaultDuration: 5,
    resolutions: ['720p', '1080p'],
    aspectRatios: WAN_ASPECT_RATIOS,
    maxImages: 1,
    maxVideos: 0,
    supportsAudio: false,
    modes: ['text-to-video', 'image-to-video'],
  },
  'wan3.0-yuanlian': {
    provider: 'seedance',
    minDuration: 2,
    maxDuration: 30,
    defaultDuration: 5,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: WAN_ASPECT_RATIOS,
    maxImages: 1,
    maxVideos: 0,
    supportsAudio: false,
    modes: ['text-to-video', 'image-to-video'],
  },
}

function normalizedModelName(model: string): string {
  return model.trim().toLowerCase()
}

function isKnownSeedanceModel(model: string): boolean {
  return normalizedModelName(model) in SEEDANCE_MODEL_PROFILES
}

export function resolveVideoProvider(
  model: string,
  hint: Partial<Pick<VideoGatewayContext, 'baseUrl' | 'platform'>> = {},
): VideoProvider {
  const value = normalizedModelName(model)
  const platform = hint.platform?.trim().toLowerCase()
  if (platform === 'grok') return 'grok'
  if (isKnownSeedanceModel(value) && (platform === 'openai' || platform === 'composite')) {
    return 'seedance_video'
  }
  try {
    const host = new URL(hint.baseUrl || '').hostname.toLowerCase()
    if ((host === 'openpix.cc' || host.endsWith('.openpix.cc') || host === 'momoapi.xin' || host.endsWith('.momoapi.xin')) &&
      isKnownSeedanceModel(value)) {
      return 'seedance_video'
    }
  } catch {
    // Relative platform URLs are resolved by the gateway, not the browser.
  }
  if (isKnownSeedanceModel(value) && (platform === 'openai' || platform === 'composite')) {
    return 'seedance'
  }
  if (value.includes('grok')) return 'grok'
  if (isKnownSeedanceModel(value) || value.startsWith('wan3.0-') || value.includes('seedance')) {
    return 'seedance'
  }
  return 'seedance'
}

export function getVideoModelProfile(model: string, provider?: VideoProvider): VideoModelProfile {
  const value = normalizedModelName(model)
  const seedanceProfile = SEEDANCE_MODEL_PROFILES[value]
  if (seedanceProfile && provider !== 'grok') {
    return seedanceProfile
  }
  if (provider === 'grok' || value.includes('grok')) {
    const grokProfile = seedanceProfile || DEFAULT_PROFILE
    return {
      ...grokProfile,
      provider: 'grok',
      minDuration: 1,
      maxDuration: value.includes('1.5') ? 15 : 10,
      defaultDuration: 8,
      resolutions: value.includes('1.5') ? ['480p', '720p', '1080p'] : ['480p', '720p'],
      maxImages: value.includes('1.5') ? 14 : 7,
      supportsAudio: value.includes('1.5'),
      modes: value.includes('1.5')
        ? [
            'text-to-video',
            'image-to-video',
            'first-last-frame',
            'reference-images',
            'reference-video',
            'video-edit',
            'video-extension',
          ]
        : ['text-to-video', 'image-to-video', 'reference-images', 'reference-video', 'video-edit', 'video-extension'],
    }
  }
  return DEFAULT_PROFILE
}

export function isVideoModel(name: string): boolean {
  const value = normalizedModelName(name)
  // Avoid broad matches such as "wan": Wanx image models start with "wanx".
  return isKnownSeedanceModel(value) ||
    value.includes('video') ||
    value.includes('seedance')
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null)
  return String(
    payload?.error?.message ||
    payload?.message ||
    `${response.status} ${response.statusText}`,
  )
}

export async function materializeVideoReferences(
  assets: VideoReferenceAsset[],
  uploadAsset: (
    request: VideoReferenceAssetUpload,
  ) => Promise<VideoReferenceAssetUploadResult> = uploadVideoReferenceAsset,
): Promise<VideoReferenceAsset[]> {
  return Promise.all(assets.map(async (asset) => {
    if (asset.kind === 'image' && asset.url.startsWith('data:image/')) {
      const entry = await uploadAsset({
        kind: 'image',
        data_url: asset.url,
      })
      if (!entry.url) throw new Error('参考图上传后没有返回公开地址')
      return { ...asset, url: entry.url }
    }
    if (asset.kind === 'video' && asset.url.startsWith('data:video/')) {
      const entry = await uploadAsset({
        kind: 'video',
        data_url: asset.url,
      })
      if (!entry.url) throw new Error('参考视频上传后没有返回公开地址')
      return { ...asset, url: entry.url }
    }
    if (asset.kind === 'audio' && asset.url.startsWith('data:audio/')) {
      const entry = await uploadAsset({
        kind: 'audio',
        data_url: asset.url,
      })
      if (!entry.url) throw new Error('参考音频上传后没有返回公开地址')
      return { ...asset, url: entry.url }
    }
    return asset
  }))
}

export function buildVideoRequest(
  provider: VideoProvider,
  params: VideoGenerationParams,
): { path: string; body: Record<string, unknown> } {
  if (provider === 'seedance_video') {
    const firstFrame = params.images.find((asset) => asset.role === 'first_frame')
    const lastFrame = params.images.find((asset) => asset.role === 'last_frame')
    const referenceImages = params.images.filter((asset) => asset.role === 'reference_image')
    const frameImages = [firstFrame, lastFrame]
      .filter((asset): asset is VideoReferenceAsset => Boolean(asset))
      .map((asset) => asset.url)
    const body: Record<string, unknown> = {
      model: params.model.trim(),
      prompt: params.prompt.trim(),
      duration: params.durationSeconds,
      resolution: params.resolution,
      aspect_ratio: params.aspectRatio,
      generate_audio: params.generateAudio,
    }
    if (params.videos.length) {
      body.mode = 'reference-video'
      body.reference_video_urls = params.videos.map((asset) => asset.url)
    } else if (firstFrame || lastFrame) {
      body.mode = firstFrame && lastFrame ? 'first-last-frame' : 'image-to-video'
    } else if (referenceImages.length) {
      body.mode = 'reference-images'
    } else {
      body.mode = 'text-to-video'
    }
    if (frameImages.length) body.images = frameImages
    if (referenceImages.length) {
      body.reference_image_urls = referenceImages.map((asset) => asset.url)
    }
    if (params.audios.length) {
      body.reference_audio_urls = params.audios.map((asset) => asset.url)
    }
    return { path: '/video/generations', body }
  }

  if (provider === 'grok') {
    const body: Record<string, unknown> = {
      model: params.model.trim(),
      prompt: params.prompt.trim(),
      duration: params.durationSeconds,
      resolution: params.resolution,
      aspect_ratio: params.aspectRatio,
    }
    if (params.images.length) {
      body.image = params.images.map((asset) => ({ url: asset.url }))
    }
    if (params.videos.length) {
      body.video = { url: params.videos[0].url }
    }
    const path = params.videos.length
      ? params.videos[0].role === 'video_extension'
        ? '/videos/extensions'
        : '/videos/edits'
      : '/videos/generations'
    return { path, body }
  }

  // Seedance 用 content 数组承载多模态参考，参考图可带 first_frame/last_frame 角色。
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: params.prompt.trim() },
  ]
  for (const asset of params.images) {
    const item: Record<string, unknown> = { type: 'image_url', image_url: { url: asset.url } }
    if (asset.role) item.role = asset.role
    content.push(item)
  }
  for (const asset of params.videos) {
    content.push({ type: 'video_url', video_url: { url: asset.url } })
  }
  for (const asset of params.audios) {
    content.push({ type: 'audio_url', audio_url: { url: asset.url } })
  }
  const body: Record<string, unknown> = {
    model: params.model.trim(),
    content,
    duration: params.durationSeconds,
    resolution: params.resolution,
    ratio: params.aspectRatio,
    generate_audio: params.generateAudio,
  }
  return { path: '/contents/generations/tasks', body }
}

export function extractRequestId(payload: any): string {
  const candidates = [
    payload?.request_id,
    payload?.id,
    payload?.task_id,
    payload?.data?.request_id,
    payload?.data?.id,
    payload?.data?.task_id,
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
}

export async function createVideoTask(
  context: VideoGatewayContext,
  params: VideoGenerationParams,
  resolvedProvider?: VideoProvider,
): Promise<{ provider: VideoProvider; requestId: string }> {
  const provider = resolvedProvider ?? resolveVideoProvider(params.model, context)
  const { path, body } = buildVideoRequest(provider, params)
  const response = await fetch(joinUrl(context.baseUrl, path), {
    method: 'POST',
    headers: { ...authHeaders(context.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      String(
        payload?.error?.message
        || payload?.message
        || `${response.status} ${response.statusText}`,
      ),
    )
  }
  const requestId = extractRequestId(payload)
  if (!requestId) throw new Error('上游没有返回视频任务 ID')
  return { provider, requestId }
}

function normalizeStatus(provider: VideoProvider, raw: string): VideoTaskStatus {
  const value = raw.trim().toLowerCase()
  if (provider === 'grok' || provider === 'seedance_video') {
    if (value === 'done' || value === 'succeeded' || value === 'completed') return 'succeeded'
    if (value === 'failed' || value === 'expired' || value === 'cancelled' || value === 'canceled') return 'failed'
    return value === 'running' || value === 'processing' || value === 'in_progress' ? 'running' : 'queued'
  }
  if (value === 'succeeded' || value === 'success' || value === 'done' || value === 'completed') return 'succeeded'
  if (value === 'failed' || value === 'cancelled' || value === 'canceled' || value === 'expired') return 'failed'
  return value === 'running' || value === 'processing' || value === 'in_progress' ? 'running' : 'queued'
}

export function parseVideoTaskSnapshot(provider: VideoProvider, payload: any): VideoTaskSnapshot {
  const rawStatus = String(payload?.status ?? payload?.data?.status ?? '')
  const status = normalizeStatus(provider, rawStatus)
  const videoUrl = provider === 'grok' || provider === 'seedance_video'
    ? String(
        payload?.video?.url ??
        payload?.metadata?.url ??
        payload?.data?.video?.url ??
        payload?.data?.metadata?.url ??
        '',
      )
    : String(payload?.content?.video_url ?? payload?.data?.content?.video_url ?? '')
  const duration = provider === 'grok' || provider === 'seedance_video'
    ? Number(
        payload?.video?.duration ??
        payload?.duration ??
        payload?.data?.video?.duration ??
        payload?.data?.duration ??
        0,
      )
    : Number(payload?.content?.duration ?? payload?.usage?.duration ?? 0)
  const errorMessage = String(
    payload?.error?.message ||
    payload?.failure_reason ||
    payload?.data?.error?.message ||
    '',
  )
  return {
    status,
    videoUrl: videoUrl.trim(),
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    rawStatus: rawStatus.trim(),
    errorMessage: errorMessage.trim(),
  }
}

export function videoTaskPath(provider: VideoProvider, requestId: string): string {
  const id = encodeURIComponent(requestId)
  return provider === 'grok' || provider === 'seedance_video'
    ? `/videos/${id}`
    : `/contents/generations/tasks/${id}`
}

export async function fetchVideoTask(
  context: VideoGatewayContext,
  provider: VideoProvider,
  requestId: string,
): Promise<VideoTaskSnapshot> {
  const response = await fetch(joinUrl(context.baseUrl, videoTaskPath(provider, requestId)), {
    headers: authHeaders(context.apiKey),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new VideoTaskRequestError(
      String(
        payload?.error?.message
        || payload?.message
        || `${response.status} ${response.statusText}`,
      ),
      response.status,
    )
  }
  return parseVideoTaskSnapshot(provider, payload)
}

// Grok 的内容接口需要带密钥请求，浏览器无法直接把它塞进 <video src>；
// Seedance 返回的是可直连的 video_url。统一在这里取回可播放地址。
export async function fetchVideoPlayableUrl(
  context: VideoGatewayContext,
  provider: VideoProvider,
  requestId: string,
  videoUrl: string,
): Promise<{ url: string; revoke: boolean }> {
  if (provider === 'seedance' && videoUrl) {
    return { url: videoUrl, revoke: false }
  }
  const response = await fetch(
    joinUrl(context.baseUrl, `${videoTaskPath(provider, requestId)}/content`),
    { headers: authHeaders(context.apiKey) },
  )
  if (!response.ok) throw new Error(await readError(response) || '下载视频内容失败')
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), revoke: true }
}

export async function cancelVideoTask(
  context: VideoGatewayContext,
  provider: VideoProvider,
  requestId: string,
): Promise<void> {
  if (provider === 'grok' || provider === 'seedance_video') return
  await fetch(joinUrl(context.baseUrl, videoTaskPath(provider, requestId)), {
    method: 'DELETE',
    headers: authHeaders(context.apiKey),
  }).catch(() => undefined)
}

// 轮询任务直到成功或失败，超时后返回最后一次快照交给调用方判断。
export async function pollVideoTask(
  context: VideoGatewayContext,
  provider: VideoProvider,
  requestId: string,
  options: {
    intervalMs?: number
    timeoutMs?: number
    retryBaseMs?: number
    isCancelled?: () => boolean
    onProgress?: (snapshot: VideoTaskSnapshot) => void
    onRetry?: (attempt: number, error: unknown) => void
  } = {},
): Promise<VideoTaskSnapshot> {
  const intervalMs = options.intervalMs ?? 3000
  const retryBaseMs = options.retryBaseMs ?? Math.max(intervalMs, 1000)
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const deadline = Date.now() + timeoutMs
  let retryAttempt = 0
  let last: VideoTaskSnapshot = {
    status: 'queued',
    videoUrl: '',
    durationSeconds: 0,
    rawStatus: '',
    errorMessage: '',
  }
  for (;;) {
    if (options.isCancelled?.()) return last
    try {
      last = await fetchVideoTask(context, provider, requestId)
      retryAttempt = 0
    } catch (error) {
      if (!isRetryableVideoPollingError(error)) throw error
      retryAttempt += 1
      options.onRetry?.(retryAttempt, error)
      if (Date.now() >= deadline) return last
      const retryDelay = Math.min(30_000, retryBaseMs * (2 ** Math.min(retryAttempt - 1, 5)))
      await new Promise((resolve) => setTimeout(resolve, retryDelay))
      continue
    }
    options.onProgress?.(last)
    if (last.status === 'succeeded' || last.status === 'failed') return last
    if (Date.now() >= deadline) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
