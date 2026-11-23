// 视频工作台的接口封装：直接调用用户自己的 API Key，
// 视频生成走异步任务协议，创建 + 轮询 + 取内容三步。
//
// 工作台支持多种视频协议，前端按模型和分组平台选择：
//   - Seedance Video（OpenAI-compatible）：POST /video/generations
//   - Muse Video（统一视频协议）：POST /video/generations
//   - Seedance（Ark 任务协议）：POST /contents/generations/tasks
//   - Grok（xAI 视频协议）：POST /videos/generations
// 三种协议的状态查询与内容下载路径不同，统一在这里归一化。

import type { VideoModelCapabilities } from '@/api/channels'
import {
  uploadVideoReferenceAsset,
  type VideoReferenceAssetUpload,
  type VideoReferenceAssetUploadResult,
} from './videoArchiveApi'

type VideoCapabilities = VideoModelCapabilities

export type VideoProvider = 'seedance' | 'seedance_video' | 'muse_video' | 'video_tasks' | 'grok'

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
  durationAuto?: boolean
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  images: VideoReferenceAsset[]
  videos: VideoReferenceAsset[]
  audios: VideoReferenceAsset[]
}

export interface VideoTaskSnapshot {
  status: VideoTaskStatus
  progress: number
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

// 常见画质档位只用于自定义渠道的兜底；平台模型以能力配置中的列表为准。
export const VIDEO_RESOLUTIONS = ['480p', '720p', '768p', '1080p'] as const

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

export interface VideoReferenceSlots {
  first_frame: number
  last_frame: number
  reference_image: number
  reference_video: number
  reference_audio: number
}

export interface VideoModelProfile {
  provider: VideoProvider
  minDuration: number
  maxDuration: number
  defaultDuration: number
  durationOptions?: readonly number[]
  resolutions: readonly string[]
  aspectRatios: readonly string[]
  maxImages: number
  maxVideos: number
  maxAudios: number
  slots: VideoReferenceSlots
  frameReferenceExclusive: boolean
  supportsAudio: boolean
  outputsAudio?: boolean
  modes: readonly VideoMode[]
  fileLimits?: {
    imageBytes?: number
    videoBytes?: number
    audioBytes?: number
    totalBytes?: number
  }
}

const DEFAULT_SLOTS: VideoReferenceSlots = {
  first_frame: 0,
  last_frame: 0,
  reference_image: 3,
  reference_video: 0,
  reference_audio: 0,
}

const DEFAULT_PROFILE: VideoModelProfile = {
  provider: 'seedance',
  minDuration: 1,
  maxDuration: 15,
  defaultDuration: 5,
  resolutions: ['480p', '720p', '1080p'],
  aspectRatios: VIDEO_ASPECT_RATIOS.map((item) => item.value),
  maxImages: 3,
  maxVideos: 1,
  maxAudios: 0,
  slots: DEFAULT_SLOTS,
  frameReferenceExclusive: false,
  supportsAudio: true,
  modes: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'],
}

function normalizedModelName(model: string): string {
  return model.trim().toLowerCase()
}

function normalizeVideoProvider(value: unknown): VideoProvider | null {
  const provider = String(value || '').trim().toLowerCase()
  if (
    provider === 'seedance' ||
    provider === 'seedance_video' ||
    provider === 'muse_video' ||
    provider === 'video_tasks' ||
    provider === 'grok'
  ) {
    return provider
  }
  return null
}

function totalImages(slots: VideoReferenceSlots): number {
  return Math.max(0, slots.first_frame) +
    Math.max(0, slots.last_frame) +
    Math.max(0, slots.reference_image)
}

function deriveVideoModes(slots: VideoReferenceSlots, configuredModes?: readonly string[]): VideoMode[] {
  const modes = new Set<VideoMode>()
  for (const mode of configuredModes || []) {
    if (
      mode === 'text-to-video' ||
      mode === 'image-to-video' ||
      mode === 'first-last-frame' ||
      mode === 'reference-images' ||
      mode === 'reference-video' ||
      mode === 'video-edit' ||
      mode === 'video-extension'
    ) {
      modes.add(mode)
    }
  }
  modes.add('text-to-video')
  if (slots.first_frame > 0) modes.add('image-to-video')
  if (slots.first_frame > 0 && slots.last_frame > 0) modes.add('first-last-frame')
  if (slots.reference_image > 0) modes.add('reference-images')
  if (slots.reference_video > 0) modes.add('reference-video')
  return Array.from(modes)
}

export function profileFromVideoCapabilities(
  provider: VideoProvider,
  capabilities?: VideoCapabilities | null,
): VideoModelProfile | null {
  if (!capabilities) return null
  const slots: VideoReferenceSlots = {
    first_frame: Math.max(0, Number(capabilities.slots?.first_frame) || 0),
    last_frame: Math.max(0, Number(capabilities.slots?.last_frame) || 0),
    reference_image: Math.max(0, Number(capabilities.slots?.reference_image) || 0),
    reference_video: Math.max(0, Number(capabilities.slots?.reference_video) || 0),
    reference_audio: Math.max(0, Number(capabilities.slots?.reference_audio) || 0),
  }
  const minDuration = Math.max(1, Number(capabilities.min_duration) || 1)
  const maxDuration = Math.max(minDuration, Number(capabilities.max_duration) || minDuration)
  const defaultDuration = Math.min(
    maxDuration,
    Math.max(minDuration, Number(capabilities.default_duration) || minDuration),
  )
  return {
    provider,
    minDuration,
    maxDuration,
    defaultDuration,
    durationOptions: Array.isArray(capabilities.duration_options)
      ? capabilities.duration_options.filter((value) => Number.isFinite(Number(value))).map(Number)
      : undefined,
    resolutions: Array.isArray(capabilities.resolutions) && capabilities.resolutions.length
      ? capabilities.resolutions
      : DEFAULT_PROFILE.resolutions,
    aspectRatios: Array.isArray(capabilities.aspect_ratios) && capabilities.aspect_ratios.length
      ? capabilities.aspect_ratios
      : DEFAULT_PROFILE.aspectRatios,
    maxImages: Math.max(0, Number(capabilities.max_images) || totalImages(slots)),
    maxVideos: slots.reference_video,
    maxAudios: slots.reference_audio,
    slots,
    frameReferenceExclusive: capabilities.frame_reference_exclusive === true,
    supportsAudio: capabilities.supports_generate_audio === true,
    outputsAudio: capabilities.outputs_audio === true,
    modes: deriveVideoModes(slots, capabilities.modes),
    fileLimits: capabilities.file_limits
      ? {
          imageBytes: capabilities.file_limits.image_bytes,
          videoBytes: capabilities.file_limits.video_bytes,
          audioBytes: capabilities.file_limits.audio_bytes,
          totalBytes: capabilities.file_limits.total_bytes,
        }
      : undefined,
  }
}

export function resolveVideoProvider(
  _model: string,
  hint: Partial<Pick<VideoGatewayContext, 'baseUrl' | 'platform'>> = {},
  capabilities?: VideoCapabilities | null,
): VideoProvider {
  const configuredProvider = normalizeVideoProvider(capabilities?.protocol)
  if (configuredProvider) return configuredProvider

  const platform = hint.platform?.trim().toLowerCase()
  if (platform === 'grok') return 'grok'
  try {
    const baseUrl = hint.baseUrl || ''
    const host = new URL(baseUrl).hostname.toLowerCase()
    if (host === 'x.ai' || host.endsWith('.x.ai')) return 'grok'
    if (host.includes('volces.com') || baseUrl.toLowerCase().includes('/api/v3')) return 'seedance'
  } catch {
    // Relative platform URLs are resolved by the gateway, not the browser.
  }
  if (platform === 'openai' || platform === 'composite') return 'seedance_video'
  return 'seedance'
}

export function getVideoModelProfile(
  model: string,
  provider?: VideoProvider,
  capabilities?: VideoCapabilities | null,
): VideoModelProfile {
  const resolvedProvider = normalizeVideoProvider(capabilities?.protocol) || provider || resolveVideoProvider(model)
  const configured = profileFromVideoCapabilities(resolvedProvider, capabilities)
  if (configured) return configured
  return { ...DEFAULT_PROFILE, provider: resolvedProvider }
}

export function isVideoModel(name: string): boolean {
  const value = normalizedModelName(name)
  return value.includes('video') ||
    value.includes('seedance') ||
    value.includes('wan3.0') ||
    /^minimax[\s_-]*h3(?:$|[^0-9])/.test(value)
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
  capabilities?: VideoCapabilities | null,
): { path: string; body: Record<string, unknown> } {
  const profile = getVideoModelProfile(params.model, provider, capabilities)

  // Native Seedance/Ark protocol carries all media in a content array.
  if (provider === 'seedance') {
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
      resolution: params.resolution,
      ratio: params.aspectRatio,
      generate_audio: params.generateAudio,
    }
    if (!params.durationAuto) body.duration = params.durationSeconds
    return { path: '/contents/generations/tasks', body }
  }

  const firstFrame = params.images.find((asset) => asset.role === 'first_frame')
  const lastFrame = params.images.find((asset) => asset.role === 'last_frame')
  const referenceImages = params.images.filter((asset) => asset.role === 'reference_image')
  const hasConfiguredFrames = profile.slots.first_frame > 0 || profile.slots.last_frame > 0
  const canUseFrames = hasConfiguredFrames &&
    !params.videos.length &&
    !params.audios.length &&
    Boolean(firstFrame || lastFrame) &&
    !(profile.frameReferenceExclusive && referenceImages.length > 0)
  const body: Record<string, unknown> = {
    model: params.model.trim(),
    prompt: params.prompt.trim(),
    resolution: params.resolution,
    aspect_ratio: params.aspectRatio,
  }
  if (!params.durationAuto) body.duration = params.durationSeconds
  if (profile.supportsAudio) body.generate_audio = params.generateAudio

  const sendMode = provider === 'seedance_video' || provider === 'grok'
  if (params.videos.length) {
    const singleRole = params.videos.length === 1 ? params.videos[0].role : undefined
    if (provider === 'grok' && (singleRole === 'video_edit' || singleRole === 'video_extension')) {
      body.mode = singleRole.replace('_', '-')
      body.reference_video_url = params.videos[0].url
    } else {
      if (sendMode) body.mode = 'reference-video'
      body.reference_video_urls = params.videos.map((asset) => asset.url)
    }
    if (params.images.length) {
      body.reference_image_urls = params.images.map((asset) => asset.url)
    }
    if (params.audios.length) {
      body.reference_audio_urls = params.audios.map((asset) => asset.url)
    }
    return { path: '/video/generations', body }
  }

  if (canUseFrames) {
    if (firstFrame && lastFrame) {
      if (sendMode) body.mode = 'first-last-frame'
      body.first_frame_image_url = firstFrame.url
      body.last_frame_image_url = lastFrame.url
    } else if (firstFrame) {
      if (sendMode) body.mode = 'image-to-video'
      if (provider === 'seedance_video') body.images = [firstFrame.url]
      else body.first_frame_image_url = firstFrame.url
    } else if (lastFrame) {
      if (sendMode) body.mode = 'image-to-video'
      if (provider === 'seedance_video') body.images = [lastFrame.url]
      else body.last_frame_image_url = lastFrame.url
    }
    if (referenceImages.length && !profile.frameReferenceExclusive) {
      body.reference_image_urls = referenceImages.map((asset) => asset.url)
    }
    return { path: '/video/generations', body }
  }

  if (params.images.length || params.audios.length) {
    if (sendMode) body.mode = 'reference-images'
    body.reference_image_urls = params.images.map((asset) => asset.url)
    if (params.audios.length) {
      body.reference_audio_urls = params.audios.map((asset) => asset.url)
    }
    return { path: '/video/generations', body }
  }

  return { path: '/video/generations', body }
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
  capabilities?: VideoCapabilities | null,
): Promise<{ provider: VideoProvider; requestId: string }> {
  const provider = resolvedProvider ?? resolveVideoProvider(params.model, context, capabilities)
  const { path, body } = buildVideoRequest(provider, params, capabilities)
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
  if (provider === 'grok' || provider === 'seedance_video' || provider === 'muse_video' || provider === 'video_tasks') {
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
  const videoUrl = provider === 'grok' || provider === 'seedance_video' || provider === 'muse_video' || provider === 'video_tasks'
    ? String(
        payload?.video?.url ??
        payload?.metadata?.url ??
        payload?.data?.video?.url ??
        payload?.data?.metadata?.url ??
        '',
      )
    : String(payload?.content?.video_url ?? payload?.data?.content?.video_url ?? '')
  const duration = provider === 'grok' || provider === 'seedance_video' || provider === 'muse_video' || provider === 'video_tasks'
    ? Number(
        payload?.video?.duration ??
        payload?.duration ??
        payload?.data?.video?.duration ??
        payload?.data?.duration ??
        0,
      )
    : Number(payload?.content?.duration ?? payload?.usage?.duration ?? 0)
  const progressValue = Number(payload?.progress ?? payload?.data?.progress ?? 0)
  const errorMessage = String(
    payload?.error?.message ||
    payload?.failure_reason ||
    payload?.data?.error?.message ||
    '',
  )
  return {
    status,
    progress: Number.isFinite(progressValue) ? Math.min(100, Math.max(0, progressValue)) : 0,
    videoUrl: safeVideoMediaURL(videoUrl),
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    rawStatus: rawStatus.trim(),
    errorMessage: errorMessage.trim(),
  }
}

export function videoTaskPath(provider: VideoProvider, requestId: string, model = ''): string {
  const id = encodeURIComponent(requestId)
  const modelHint = provider === 'seedance_video' && model.trim()
    ? `?model=${encodeURIComponent(model.trim())}`
    : ''
  if (provider === 'video_tasks') {
    return `/videos/${id}?model=${encodeURIComponent(model.trim() || 'MiniMax-H3')}`
  }
  if (provider === 'muse_video') {
    return `/videos/${id}?model=${encodeURIComponent(model.trim() || 'muse-video')}`
  }
  if (provider === 'grok') return `/videos/${id}`
  if (provider === 'seedance_video') return `/videos/${id}${modelHint}`
  return `/contents/generations/tasks/${id}`
}

function videoContentPath(provider: VideoProvider, requestId: string, model = ''): string {
  const id = encodeURIComponent(requestId)
  if (provider === 'video_tasks') {
    return `/videos/${id}/content?model=${encodeURIComponent(model.trim() || 'MiniMax-H3')}`
  }
  if (provider === 'muse_video') {
    return `/videos/${id}/content?model=${encodeURIComponent(model.trim() || 'muse-video')}`
  }
  if (provider === 'seedance_video') {
    const modelHint = model.trim() ? `?model=${encodeURIComponent(model.trim())}` : ''
    return `/videos/${id}/content${modelHint}`
  }
  if (provider === 'seedance') {
    const modelHint = model.trim() ? `?model=${encodeURIComponent(model.trim())}` : ''
    return `/videos/${id}/content${modelHint}`
  }
  return `${videoTaskPath(provider, requestId, model)}/content`
}

export async function fetchVideoTask(
  context: VideoGatewayContext,
  provider: VideoProvider,
  requestId: string,
  model = '',
): Promise<VideoTaskSnapshot> {
  const response = await fetch(joinUrl(context.baseUrl, videoTaskPath(provider, requestId, model)), {
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
  _videoUrl: string,
  model = '',
): Promise<{ url: string; revoke: boolean }> {
  const response = await fetch(
    joinUrl(context.baseUrl, videoContentPath(provider, requestId, model)),
    { headers: authHeaders(context.apiKey) },
  )
  if (!response.ok) throw new Error(await readError(response) || '下载视频内容失败')
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), revoke: true }
}

function safeVideoMediaURL(raw: string) {
  const value = raw.trim()
  if (!value) return ''
  if (value.startsWith('/')) return value
  if (typeof window === 'undefined') return ''
  try {
    return new URL(value, window.location.origin).origin === window.location.origin ? value : ''
  } catch {
    return ''
  }
}

export async function cancelVideoTask(
  context: VideoGatewayContext,
  provider: VideoProvider,
  requestId: string,
): Promise<void> {
  if (provider === 'grok' || provider === 'seedance_video' || provider === 'muse_video' || provider === 'video_tasks') return
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
    model?: string
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
    progress: 0,
    videoUrl: '',
    durationSeconds: 0,
    rawStatus: '',
    errorMessage: '',
  }
  for (;;) {
    if (options.isCancelled?.()) return last
    try {
      last = await fetchVideoTask(context, provider, requestId, options.model)
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
