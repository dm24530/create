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
  videoTaskPath,
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

  it('recognizes Muse video models without matching Muse chat models', () => {
    expect(isVideoModel('muse-video')).toBe(true)
    expect(isVideoModel('muse-cheap')).toBe(true)
    expect(isVideoModel('muse-spark-1.3-contributor')).toBe(false)
  })

  it('recognizes the whole minimax H3 model family as video models', () => {
    expect(isVideoModel('minimax H3')).toBe(true)
    expect(isVideoModel('MiniMax-H3')).toBe(true)
    expect(isVideoModel('MiniMax_H3')).toBe(true)
    expect(isVideoModel('minimax H3-self')).toBe(true)
    expect(isVideoModel('minimax H3-pro')).toBe(true)
    expect(isVideoModel('minimax image')).toBe(false)
  })

  it('uses the Seedance video protocol for documented models on OpenAI groups', () => {
    expect(resolveVideoProvider('seedance-2.5', { platform: 'openai' })).toBe('seedance_video')
    expect(resolveVideoProvider('wan3.0-video', { platform: 'openai' })).toBe('seedance_video')
    expect(resolveVideoProvider('wan3.0-yuanlian')).toBe('seedance')
    expect(resolveVideoProvider('grok-imagine-video', { platform: 'grok' })).toBe('grok')
    expect(resolveVideoProvider('grok-imagine-video', { platform: 'openai' })).toBe('seedance_video')
    expect(resolveVideoProvider('seedance-2-720p', { baseUrl: '/v1', platform: 'openai' })).toBe('seedance')
  })

  it('maps every minimax H3 variant to the unified video generation protocol', () => {
    expect(resolveVideoProvider('minimax H3', { platform: 'openai' })).toBe('video_tasks')
    expect(resolveVideoProvider('MiniMax-H3', { platform: 'openai' })).toBe('video_tasks')
    expect(resolveVideoProvider('MiniMax_H3')).toBe('video_tasks')
    expect(resolveVideoProvider('minimax H3-self')).toBe('video_tasks')
    expect(resolveVideoProvider('minimax H3-pro', { platform: 'composite' })).toBe('video_tasks')
  })

  it('routes Muse video models to the Muse video protocol', () => {
    expect(resolveVideoProvider('muse-video')).toBe('muse_video')
    expect(resolveVideoProvider('muse-video', { platform: 'openai' })).toBe('muse_video')
    expect(resolveVideoProvider('muse-cheap', { baseUrl: 'https://momoapi.xin/v1' })).toBe('muse_video')
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

    const minimaxH3 = getVideoModelProfile('minimax H3-self', 'video_tasks')
    expect(minimaxH3.provider).toBe('video_tasks')
    expect(minimaxH3.minDuration).toBe(1)
    expect(minimaxH3.maxDuration).toBe(15)
    expect(minimaxH3.defaultDuration).toBe(5)
    expect(minimaxH3.resolutions).toEqual(['768P'])
    expect(minimaxH3.aspectRatios).toEqual(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
    expect(minimaxH3.maxImages).toBe(9)
    expect(minimaxH3.maxVideos).toBe(3)
    expect(minimaxH3.supportsAudio).toBe(true)
    expect(minimaxH3.modes).toEqual(['text-to-video', 'image-to-video', 'first-last-frame', 'reference-images', 'reference-video'])

    const museVideo = getVideoModelProfile('muse-video', 'muse_video')
    expect(museVideo.provider).toBe('muse_video')
    expect(museVideo.minDuration).toBe(1)
    expect(museVideo.maxDuration).toBe(15)
    expect(museVideo.defaultDuration).toBe(10)
    expect(museVideo.resolutions).toEqual(['720p'])
    expect(museVideo.aspectRatios).toEqual(['16:9', '9:16'])
    expect(museVideo.maxImages).toBe(4)
    expect(museVideo.maxVideos).toBe(0)
    expect(museVideo.supportsAudio).toBe(false)
    expect(museVideo.outputsAudio).toBe(true)
    expect(museVideo.modes).toEqual(['text-to-video', 'image-to-video', 'reference-images'])

    const museCheap = getVideoModelProfile('muse-cheap', 'muse_video')
    expect(museCheap.maxDuration).toBe(30)
    expect(museCheap.defaultDuration).toBe(10)
    expect(museCheap.maxImages).toBe(7)
    expect(museCheap.outputsAudio).toBe(true)
    expect(museCheap.durationOptions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30])
    expect(museCheap.modes).toEqual(['text-to-video', 'reference-images'])
  })
})

describe('Seedance video request mapping', () => {
  const base = {
    model: 'seedance-2.5',
    prompt: 'slow push in',
    durationSeconds: 12,
    durationAuto: false,
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

  it('omits duration fields when automatic duration is selected', () => {
    const request = buildVideoRequest('muse_video', {
      ...base,
      model: 'muse-video',
      durationSeconds: 10,
      durationAuto: true,
      resolution: '720p',
    })

    expect(request.body).not.toHaveProperty('seconds')
    expect(request.body).not.toHaveProperty('duration')
  })

  it('builds the documented Muse text-to-video body', () => {
    const request = buildVideoRequest('muse_video', {
      ...base,
      model: 'muse-video',
      durationSeconds: 6,
      resolution: '720p',
    })

    expect(request.path).toBe('/videos')
    expect(request.body).toEqual({
      model: 'muse-video',
      prompt: 'slow push in',
      seconds: 6,
      aspect_ratio: '16:9',
    })
  })

  it('uses the Muse images array for image-to-video', () => {
    const request = buildVideoRequest('muse_video', {
      ...base,
      model: 'muse-video',
      images: [{
        id: 1,
        kind: 'image',
        name: 'first.png',
        url: 'https://cdn.example.com/first.png',
        role: 'first_frame',
      }],
    })

    expect(request.body).toMatchObject({
      model: 'muse-video',
      image: 'https://cdn.example.com/first.png',
    })
    expect(request.body).not.toHaveProperty('mode')
    expect(request.body).not.toHaveProperty('images')
    expect(request.body).not.toHaveProperty('resolution')
  })

  it('uses Muse reference-image fields when first-frame and references are combined', () => {
    const request = buildVideoRequest('muse_video', {
      ...base,
      model: 'muse-video',
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
          name: 'ref.png',
          url: 'https://cdn.example.com/ref.png',
          role: 'reference_image',
        },
      ],
    })

    expect(request.body).toMatchObject({
      model: 'muse-video',
      image: 'https://cdn.example.com/first.png',
      reference_images: ['https://cdn.example.com/ref.png'],
    })
    expect(request.body).not.toHaveProperty('images')
    expect(request.body).not.toHaveProperty('mode')
    expect(request.body).not.toHaveProperty('duration')
  })

  it('keeps Muse cheap reference images out of the first-frame image field', () => {
    const request = buildVideoRequest('muse_video', {
      ...base,
      model: 'muse-cheap',
      images: [{
        id: 1,
        kind: 'image',
        name: 'ref.png',
        url: 'https://cdn.example.com/ref.png',
        role: 'reference_image',
      }],
    })

    expect(request.body).toMatchObject({
      model: 'muse-cheap',
      reference_images: ['https://cdn.example.com/ref.png'],
    })
    expect(request.body).not.toHaveProperty('image')
  })

  it('normalizes in-progress Seedance status responses', () => {
    expect(parseVideoTaskSnapshot('seedance', { status: 'in_progress' }).status).toBe('running')
    const completed = parseVideoTaskSnapshot('seedance', {
      status: 'completed',
      content: { video_url: '/videos/task-1/content', duration: 12 },
    })
    expect(completed.status).toBe('succeeded')
    expect(completed.durationSeconds).toBe(12)
    expect(completed.videoUrl).toBe('/videos/task-1/content')
  })

  it('normalizes completed Muse status responses with a content URL', () => {
    const completed = parseVideoTaskSnapshot('muse_video', {
      id: 'task-muse',
      status: 'completed',
      duration: 6,
      metadata: { url: '/v1/videos/task-muse/content' },
    })

    expect(completed.status).toBe('succeeded')
    expect(completed.durationSeconds).toBe(6)
    expect(completed.videoUrl).toBe('/v1/videos/task-muse/content')
  })

  it('preserves Muse progress while the upstream still reports queued', () => {
    const queued = parseVideoTaskSnapshot('muse_video', {
      id: 'task-muse',
      status: 'queued',
      progress: 40,
    })

    expect(queued.status).toBe('queued')
    expect(queued.progress).toBe(40)
  })

  it('routes Muse status lookups with a model hint for composite keys', () => {
    expect(videoTaskPath('muse_video', 'task/muse')).toBe('/videos/task%2Fmuse?model=muse-video')
  })

  it('routes Seedance video lookups with a model hint for composite keys', () => {
    expect(videoTaskPath('seedance_video', 'task/seedance', 'seedance-2.5'))
      .toBe('/videos/task%2Fseedance?model=seedance-2.5')
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

  it('submits minimax H3 through the unified video endpoint', () => {
    const model = 'minimax H3-self'
    const provider = resolveVideoProvider(model, { platform: 'openai' })
    const request = buildVideoRequest(provider, {
      ...base,
      model,
      durationSeconds: 5,
      resolution: '768p',
      aspectRatio: '9:16',
    })

    expect(provider).toBe('video_tasks')
    expect(request.path).toBe('/videos')
    expect(request.body).toMatchObject({
      model,
      seconds: '5',
      resolution: '768P',
      ratio: '9:16',
    })
    expect(request.body).not.toHaveProperty('mode')
    expect(request.body).not.toHaveProperty('duration')
    expect(request.body).not.toHaveProperty('generate_audio')
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
          content: { video_url: '/videos/task-1/content' },
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
    expect(snapshot.videoUrl).toBe('/videos/task-1/content')
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
