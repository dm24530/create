import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildVideoRequest,
  createVideoTask,
  getVideoModelProfile,
  isVideoModel,
  materializeVideoReferences,
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

  it('sends generate_audio as an explicit boolean in the native Seedance body', () => {
    const request = buildVideoRequest('seedance', {
      ...base,
      generateAudio: false,
    })

    expect(request.body).toHaveProperty('generate_audio', false)
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

  it('keeps first/last frames, reference images, videos and audio together', () => {
    const request = buildVideoRequest('seedance_video', {
      ...base,
      generateAudio: false,
      images: [
        {
          id: 1,
          kind: 'image',
          name: 'first.png',
          url: 'https://cdn.example.com/first.png',
          role: 'first_frame',
        },
        {
          id: 2,
          kind: 'image',
          name: 'last.png',
          url: 'https://cdn.example.com/last.png',
          role: 'last_frame',
        },
        {
          id: 3,
          kind: 'image',
          name: 'ref.png',
          url: 'https://cdn.example.com/ref.png',
          role: 'reference_image',
        },
      ],
      videos: [{
        id: 4,
        kind: 'video',
        name: 'ref.mp4',
        url: 'https://cdn.example.com/ref.mp4',
        role: 'video_edit',
      }],
      audios: [{
        id: 5,
        kind: 'audio',
        name: 'ref.mp3',
        url: 'https://cdn.example.com/ref.mp3',
      }],
    })

    expect(request.body).toMatchObject({
      mode: 'reference-video',
      images: [
        'https://cdn.example.com/first.png',
        'https://cdn.example.com/last.png',
      ],
      reference_image_urls: ['https://cdn.example.com/ref.png'],
      reference_video_urls: ['https://cdn.example.com/ref.mp4'],
      reference_audio_urls: ['https://cdn.example.com/ref.mp3'],
      generate_audio: false,
    })
  })

  it('routes Grok video edits and extensions to their documented endpoints', () => {
    const edit = buildVideoRequest('grok', {
      ...base,
      model: 'grok-imagine-video-1.5',
      videos: [{
        id: 1,
        kind: 'video',
        name: 'source.mp4',
        url: 'https://cdn.example.com/source.mp4',
        role: 'video_edit',
      }],
    })
    expect(edit.path).toBe('/videos/edits')
    expect(edit.body.video).toEqual({ url: 'https://cdn.example.com/source.mp4' })

    const extension = buildVideoRequest('grok', {
      ...base,
      model: 'grok-imagine-video-1.5',
      videos: [{
        id: 2,
        kind: 'video',
        name: 'source.mp4',
        url: 'https://cdn.example.com/source.mp4',
        role: 'video_extension',
      }],
    })
    expect(extension.path).toBe('/videos/extensions')
    expect(extension.body.video).toEqual({ url: 'https://cdn.example.com/source.mp4' })
  })
})

describe('Seedance reference uploads', () => {
  it('replaces local image and video data URLs with public object-storage URLs', async () => {
    const uploadAsset = vi.fn()
      .mockResolvedValueOnce({ url: 'https://r2.example.com/frame.png' })
      .mockResolvedValueOnce({ url: 'https://r2.example.com/reference.mp4' })
      .mockResolvedValueOnce({ url: 'https://r2.example.com/reference.mp3' })
    const assets = await materializeVideoReferences([
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
      {
        id: 4,
        kind: 'audio',
        name: 'reference.mp3',
        url: 'data:audio/mpeg;base64,bXAz',
      },
    ], uploadAsset)

    expect(uploadAsset).toHaveBeenNthCalledWith(1, {
      kind: 'image',
      data_url: 'data:image/png;base64,dGlueQ==',
    })
    expect(uploadAsset).toHaveBeenNthCalledWith(2, {
      kind: 'video',
      data_url: 'data:video/mp4;base64,dmlkZW8=',
    })
    expect(uploadAsset).toHaveBeenNthCalledWith(3, {
      kind: 'audio',
      data_url: 'data:audio/mpeg;base64,bXAz',
    })
    expect(assets.map((asset) => asset.url)).toEqual([
      'https://r2.example.com/frame.png',
      'https://cdn.example.com/remote.png',
      'https://r2.example.com/reference.mp4',
      'https://r2.example.com/reference.mp3',
    ])
  })
})

describe('provider selection', () => {
  it('uses the provider resolved before task creation even for a custom base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: 'task-ark' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const created = await createVideoTask({
      baseUrl: 'https://custom-seedance.example/v1',
      apiKey: 'sk-custom',
      platform: 'openai',
    }, {
      model: 'seedance-2.5',
      prompt: 'waves',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
      images: [],
      videos: [],
      audios: [],
    }, 'seedance')

    expect(created.provider).toBe('seedance')
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://custom-seedance.example/v1/contents/generations/tasks')
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
