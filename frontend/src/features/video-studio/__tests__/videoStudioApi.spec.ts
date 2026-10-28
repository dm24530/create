import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildVideoRequest,
  createVideoTask,
  getVideoModelProfile,
  isVideoModel,
  materializeSeedanceReferences,
  parseVideoTaskSnapshot,
  pollVideoTask,
  resolveVideoProvider,
} from '../videoStudioApi'

const context = { baseUrl: '/v1', apiKey: 'sk-test' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('video model classification', () => {
  it('does not treat Wanx image models as video models', () => {
    expect(isVideoModel('wanx2.1-t2i-turbo')).toBe(false)
    expect(isVideoModel('wanx2.1-t2i-plus')).toBe(false)
    expect(isVideoModel('wan2.2-t2i-flash')).toBe(false)
  })

  it('keeps the supported Seedance and Grok video model families', () => {
    expect(isVideoModel('seedance-2-720p')).toBe(true)
    expect(isVideoModel('grok-imagine-video')).toBe(true)
    expect(isVideoModel('grok-imagine-video-1.5')).toBe(true)
    expect(isVideoModel('wan3.0-yuanlian')).toBe(true)
  })

  it('uses the Seedance video protocol for documented models on OpenAI groups', () => {
    expect(resolveVideoProvider('seedance-2.5', { platform: 'openai' })).toBe('seedance_video')
    expect(resolveVideoProvider('wan3.0-video', { platform: 'openai' })).toBe('seedance_video')
    expect(resolveVideoProvider('wan3.0-yuanlian')).toBe('seedance')
    expect(resolveVideoProvider('grok-imagine-video', { platform: 'grok' })).toBe('grok')
    expect(resolveVideoProvider('grok-imagine-video', { platform: 'openai' })).toBe('seedance_video')
    expect(resolveVideoProvider('seedance-2-720p', { baseUrl: '/v1', platform: 'openai' })).toBe('seedance')
  })

  it('applies model-specific duration, resolution and reference limits', () => {
    const seedance25 = getVideoModelProfile('seedance-2.5', 'seedance')
    expect(seedance25.maxDuration).toBe(30)
    expect(seedance25.resolutions).toContain('1080p')
    expect(seedance25.maxImages).toBe(30)

    const wan = getVideoModelProfile('wan3.0-video', 'seedance')
    expect(wan.minDuration).toBe(2)
    expect(wan.maxDuration).toBe(30)
    expect(wan.resolutions).not.toContain('480p')
    expect(wan.maxVideos).toBe(0)

    const grokOfficial = getVideoModelProfile('grok-imagine-video', 'grok')
    expect(grokOfficial.maxDuration).toBe(10)
    expect(grokOfficial.resolutions).not.toContain('1080p')
  })
})

describe('Seedance video request mapping', () => {
  const base = {
    model: 'seedance-2.5',
    prompt: 'slow push in',
    durationSeconds: 12,
    resolution: '1080p',
    aspectRatio: '16:9',
    generateAudio: true,
    images: [],
    videos: [],
    audios: [],
  }

  it('keeps duration, resolution, ratio and reference image in the Ark content body', () => {
    const request = buildVideoRequest('seedance', {
      ...base,
      images: [{
        id: 1,
        kind: 'image',
        name: 'first.png',
        url: 'https://cdn.example.com/first.png',
        role: 'first_frame',
      }],
    })

    expect(request.path).toBe('/contents/generations/tasks')
    expect(request.body).toMatchObject({
      model: 'seedance-2.5',
      duration: 12,
      resolution: '1080p',
      ratio: '16:9',
      generate_audio: true,
    })
    expect(request.body.content).toEqual([
      { type: 'text', text: 'slow push in' },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/first.png' },
        role: 'first_frame',
      },
    ])
  })

  it('preserves reference image and video entries in the Ark content array', () => {
    const request = buildVideoRequest('seedance', {
      ...base,
      images: [{
        id: 1,
        kind: 'image',
        name: 'ref.png',
        url: 'https://cdn.example.com/ref.png',
        role: 'reference_image',
      }],
      videos: [{
        id: 2,
        kind: 'video',
        name: 'ref.mp4',
        url: 'https://cdn.example.com/ref.mp4',
      }],
      audios: [{
        id: 3,
        kind: 'audio',
        name: 'ref.mp3',
        url: 'https://cdn.example.com/ref.mp3',
      }],
    })
    expect(request.body.content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn.example.com/ref.png' },
      role: 'reference_image',
    })
    expect(request.body.content).toContainEqual({
      type: 'video_url',
      video_url: { url: 'https://cdn.example.com/ref.mp4' },
    })
    expect(request.body.content).toContainEqual({
      type: 'audio_url',
      audio_url: { url: 'https://cdn.example.com/ref.mp3' },
    })
  })

  it('normalizes in-progress Seedance status responses', () => {
    expect(parseVideoTaskSnapshot('seedance', { status: 'in_progress' }).status).toBe('running')
    const completed = parseVideoTaskSnapshot('seedance', {
      status: 'completed',
      content: { video_url: 'https://cdn.example.com/out.mp4', duration: 12 },
    })
    expect(completed.status).toBe('succeeded')
    expect(completed.durationSeconds).toBe(12)
    expect(completed.videoUrl).toBe('https://cdn.example.com/out.mp4')
  })

  it('builds the unified Seedance video body with reference fields', () => {
    const request = buildVideoRequest('seedance_video', {
      ...base,
      model: 'dreamina-seedance-2-0-fast-260128',
      images: [{
        id: 1,
        kind: 'image',
        name: 'ref.png',
        url: 'https://cdn.example.com/ref.png',
        role: 'reference_image',
      }],
      videos: [{
        id: 2,
        kind: 'video',
        name: 'ref.mp4',
        url: 'https://cdn.example.com/ref.mp4',
      }],
    })

    expect(request.path).toBe('/video/generations')
    expect(request.body).toMatchObject({
      model: 'dreamina-seedance-2-0-fast-260128',
      mode: 'reference-video',
      prompt: 'slow push in',
      duration: 12,
      resolution: '1080p',
      aspect_ratio: '16:9',
      reference_video_urls: ['https://cdn.example.com/ref.mp4'],
      reference_image_urls: ['https://cdn.example.com/ref.png'],
    })
  })
})

describe('Seedance reference uploads', () => {
  it('replaces local image and video data URLs with public object-storage URLs', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ url: 'https://r2.example.com/frame.png' })
    const uploadVideo = vi.fn().mockResolvedValue({ url: 'https://r2.example.com/reference.mp4' })
    const assets = await materializeSeedanceReferences([
      {
        id: 1,
        kind: 'image',
        name: 'frame.png',
        url: 'data:image/png;base64,dGlueQ==',
        role: 'first_frame',
      },
      {
        id: 2,
        kind: 'image',
        name: 'remote.png',
        url: 'https://cdn.example.com/remote.png',
        role: 'reference_image',
      },
      {
        id: 3,
        kind: 'video',
        name: 'reference.mp4',
        url: 'data:video/mp4;base64,dmlkZW8=',
      },
    ], 'seedance-2.5', uploadImage, uploadVideo)

    expect(uploadImage).toHaveBeenCalledWith({
      image_data_url: 'data:image/png;base64,dGlueQ==',
      prompt: 'Video reference image',
      model: 'seedance-2.5',
      size: 'reference',
      format: 'png',
      saved: false,
    })
    expect(uploadVideo).toHaveBeenCalledWith({
      video_data_url: 'data:video/mp4;base64,dmlkZW8=',
      prompt: 'Video reference',
      model: 'seedance-2.5',
      format: 'mp4',
      duration_seconds: 0,
      saved: false,
    })
    expect(assets.map((asset) => asset.url)).toEqual([
      'https://r2.example.com/frame.png',
      'https://cdn.example.com/remote.png',
      'https://r2.example.com/reference.mp4',
    ])
  })
})

describe('pollVideoTask network recovery', () => {
  it('retries transient network failures until the task can be read again', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'succeeded',
          content: { video_url: 'https://cdn.example.com/out.mp4' },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()

    const snapshot = await pollVideoTask(context, 'seedance', 'task-1', {
      intervalMs: 1,
      retryBaseMs: 1,
      timeoutMs: 1000,
      onRetry,
    })

    expect(snapshot.status).toBe('succeeded')
    expect(snapshot.videoUrl).toBe('https://cdn.example.com/out.mp4')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'invalid api key' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(pollVideoTask(context, 'seedance', 'task-1', {
      intervalMs: 1,
      retryBaseMs: 1,
      timeoutMs: 1000,
    })).rejects.toThrow('invalid api key')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('createVideoTask errors', () => {
  it('uses the already parsed upstream error instead of reading the body twice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { message: 'model is unavailable' } }),
    }))

    await expect(createVideoTask(context, {
      model: 'grok-video',
      prompt: 'a cat',
      durationSeconds: 6,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
      images: [],
      videos: [],
      audios: [],
    })).rejects.toThrow('model is unavailable')
  })
})
