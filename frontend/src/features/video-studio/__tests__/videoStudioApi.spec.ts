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
import { capabilityFor } from './videoCapabilityFixtures'

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

  it('uses capability metadata to expose non-obvious Muse video model names', () => {
    expect(isVideoModel('muse-video')).toBe(true)
    expect(Boolean(capabilityFor('muse-cheap'))).toBe(true)
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

  it('uses the capability protocol instead of concrete model-name routing', () => {
    expect(resolveVideoProvider('seedance-2.5', { platform: 'openai' }, capabilityFor('seedance-2.5'))).toBe('seedance_video')
    expect(resolveVideoProvider('wan3.0-video', { platform: 'openai' }, {
      ...capabilityFor('seedance-2.5')!,
      protocol: 'seedance_video',
    })).toBe('seedance_video')
    expect(resolveVideoProvider('wan3.0-yuanlian', {}, capabilityFor('wan3.0-yuanlian'))).toBe('seedance_video')
    expect(resolveVideoProvider('grok-imagine-video', { platform: 'grok' }, capabilityFor('grok-imagine-video'))).toBe('grok')
    expect(resolveVideoProvider('seedance-2-720p', { baseUrl: '/v1', platform: 'openai' }, capabilityFor('seedance-2-720p'))).toBe('seedance')
  })

  it('selects the native Ark task protocol for an OpenAI Ark base URL', () => {
    expect(resolveVideoProvider('seedance 2.5-GT', {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      platform: 'openai',
    })).toBe('seedance')
  })

  it('keeps direct xAI Grok routing even when the group platform is OpenAI', () => {
    expect(resolveVideoProvider('grok-imagine-video-1.5', {
      baseUrl: 'https://api.x.ai/v1',
      platform: 'openai',
    })).toBe('grok')
  })

  it('maps every minimax H3 variant through its configured protocol', () => {
    const minimax = capabilityFor('minimax h3')!
    expect(resolveVideoProvider('minimax H3', { platform: 'openai' }, minimax)).toBe('video_tasks')
    expect(resolveVideoProvider('MiniMax-H3', { platform: 'openai' }, minimax)).toBe('video_tasks')
    expect(resolveVideoProvider('MiniMax_H3', {}, minimax)).toBe('video_tasks')
    expect(resolveVideoProvider('minimax H3-self', {}, capabilityFor('minimax h3-self'))).toBe('video_tasks')
    expect(resolveVideoProvider('minimax H3-pro', { platform: 'composite' }, minimax)).toBe('video_tasks')
  })

  it('routes Muse video models through their configured protocol', () => {
    expect(resolveVideoProvider('muse-video', {}, capabilityFor('muse-video'))).toBe('muse_video')
    expect(resolveVideoProvider('muse-video', { platform: 'openai' }, capabilityFor('muse-video'))).toBe('muse_video')
    expect(resolveVideoProvider('muse-cheap', { baseUrl: 'https://momoapi.xin/v1' }, capabilityFor('muse-cheap'))).toBe('muse_video')
  })

  it('applies model-specific duration, resolution and reference limits', () => {
    const seedance25 = getVideoModelProfile('seedance-2.5', 'seedance_video', capabilityFor('seedance-2.5'))
    expect(seedance25.maxDuration).toBe(30)
    expect(seedance25.resolutions).not.toContain('1080p')
    expect(seedance25.maxImages).toBe(30)
    expect(seedance25.maxVideos).toBe(10)
    expect(seedance25.maxAudios).toBe(10)

    const wan = getVideoModelProfile('wan3.0-video', 'seedance_video', { ...capabilityFor('seedance-2.5')!, min_duration: 2, max_duration: 30, resolutions: ['480p', '720p', '1080p'], slots: { first_frame: 0, last_frame: 0, reference_image: 10, reference_video: 0, reference_audio: 5 } })
    expect(wan.minDuration).toBe(2)
    expect(wan.maxDuration).toBe(30)
    expect(wan.resolutions).toContain('480p')
    expect(wan.maxVideos).toBe(0)

    const grokOfficial = getVideoModelProfile('grok-imagine-video', 'grok', capabilityFor('grok-imagine-video'))
    expect(grokOfficial.maxDuration).toBe(10)
    expect(grokOfficial.resolutions).not.toContain('1080p')

    const minimaxH3 = getVideoModelProfile('minimax H3-self', 'video_tasks', capabilityFor('minimax h3-self'))
    expect(minimaxH3.provider).toBe('video_tasks')
    expect(minimaxH3.minDuration).toBe(1)
    expect(minimaxH3.maxDuration).toBe(15)
    expect(minimaxH3.defaultDuration).toBe(5)
    expect(minimaxH3.resolutions).toEqual(['480p', '768p'])
    expect(minimaxH3.aspectRatios).toEqual(['16:9', '9:16'])
    expect(minimaxH3.maxImages).toBe(9)
    expect(minimaxH3.maxVideos).toBe(0)
    expect(minimaxH3.maxAudios).toBe(3)
    expect(minimaxH3.supportsAudio).toBe(false)
    expect(minimaxH3.modes).toEqual(['text-to-video', 'reference-images'])

    const museVideo = getVideoModelProfile('muse-video', 'muse_video', capabilityFor('muse-video'))
    expect(museVideo.provider).toBe('muse_video')
    expect(museVideo.minDuration).toBe(1)
    expect(museVideo.maxDuration).toBe(60)
    expect(museVideo.defaultDuration).toBe(6)
    expect(museVideo.resolutions).toEqual(['720p'])
    expect(museVideo.aspectRatios).toEqual(['16:9', '9:16'])
    expect(museVideo.maxImages).toBe(4)
    expect(museVideo.maxVideos).toBe(0)
    expect(museVideo.supportsAudio).toBe(false)
    expect(museVideo.outputsAudio).toBe(true)
    expect(museVideo.modes).toEqual(['text-to-video', 'image-to-video', 'reference-images'])

    const museCheap = getVideoModelProfile('muse-cheap', 'muse_video', capabilityFor('muse-cheap'))
    expect(museCheap.maxDuration).toBe(30)
    expect(museCheap.defaultDuration).toBe(10)
    expect(museCheap.maxImages).toBe(7)
    expect(museCheap.outputsAudio).toBe(true)
    expect(museCheap.durationOptions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30])
    expect(museCheap.modes).toEqual(['text-to-video', 'reference-images'])
  })

  it('applies documented limits to aliases and Wan Yuanlian', () => {
    const gt = getVideoModelProfile('seedance 2.5-GT', 'seedance_video', capabilityFor('seedance 2.5-gt'))
    expect(gt.minDuration).toBe(4)
    expect(gt.maxDuration).toBe(30)
    expect(gt.maxVideos).toBe(10)
    expect(gt.maxAudios).toBe(10)

    const yuanlian = getVideoModelProfile('wan3.0-yuanlian', 'seedance_video', capabilityFor('wan3.0-yuanlian'))
    expect(yuanlian.maxImages).toBe(10)
    expect(yuanlian.maxVideos).toBe(5)
    expect(yuanlian.maxAudios).toBe(5)
  })

  it('matches documented duration defaults and presets', () => {
    expect(getVideoModelProfile('muse-video', 'muse_video', capabilityFor('muse-video')).defaultDuration).toBe(6)
    expect(getVideoModelProfile('grok-imagine-video-1.5', 'grok', capabilityFor('grok-imagine-video-1.5')).defaultDuration).toBe(5)
    expect(getVideoModelProfile('minimax H3', 'video_tasks', capabilityFor('minimax h3')).defaultDuration).toBe(15)
    expect(getVideoModelProfile('seedance 2.0 fast-GT', 'seedance_video', capabilityFor('seedance 2.0 fast-gt')).durationOptions).toEqual([10, 15])
    expect(getVideoModelProfile('seedance 2.0 fast-GT', 'seedance_video', capabilityFor('seedance 2.0 fast-gt')).defaultDuration).toBe(15)
    expect(getVideoModelProfile('seedance-2.0-mini-Chovy', 'seedance_video', capabilityFor('seedance-2.0-mini-chovy')).durationOptions).toEqual([5, 10, 15])
    expect(getVideoModelProfile('seedance-2.5-alioth', 'seedance_video', capabilityFor('seedance-2.5-alioth')).defaultDuration).toBe(30)
    expect(getVideoModelProfile('seedance-2.5-merak', 'seedance_video', capabilityFor('seedance-2.5-merak')).defaultDuration).toBe(30)
    expect(getVideoModelProfile('wan3.0-yuanlian', 'seedance_video', capabilityFor('wan3.0-yuanlian')).defaultDuration).toBe(2)
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
  const buildRequestWithCapabilities = (
    provider: Parameters<typeof buildVideoRequest>[0],
    params: Parameters<typeof buildVideoRequest>[1],
  ) => buildVideoRequest(provider, params, capabilityFor(params.model))

  it('keeps duration, resolution, ratio and reference image in the Ark content body', () => {
    const request = buildRequestWithCapabilities('seedance', {
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
    const request = buildRequestWithCapabilities('seedance', {
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
    const request = buildRequestWithCapabilities('seedance', {
      ...base,
      generateAudio: false,
    })

    expect(request.body).toHaveProperty('generate_audio', false)
  })

  it('omits duration fields when automatic duration is selected', () => {
    const request = buildRequestWithCapabilities('muse_video', {
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
    const request = buildRequestWithCapabilities('muse_video', {
      ...base,
      model: 'muse-video',
      durationSeconds: 6,
      resolution: '720p',
    })

    expect(request.path).toBe('/video/generations')
    expect(request.body).toEqual({
      model: 'muse-video',
      prompt: 'slow push in',
      duration: 6,
      resolution: '720p',
      aspect_ratio: '16:9',
    })
  })

  it('uses the Muse images array for image-to-video', () => {
    const request = buildRequestWithCapabilities('muse_video', {
      ...base,
      model: 'muse-video',
      resolution: '720p',
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
      first_frame_image_url: 'https://cdn.example.com/first.png',
      resolution: '720p',
    })
    expect(request.body).not.toHaveProperty('mode')
    expect(request.body).not.toHaveProperty('images')
  })

  it('uses Muse reference-image fields when first-frame and references are combined', () => {
    const request = buildRequestWithCapabilities('muse_video', {
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
      first_frame_image_url: 'https://cdn.example.com/first.png',
      reference_image_urls: ['https://cdn.example.com/ref.png'],
    })
    expect(request.body).not.toHaveProperty('images')
    expect(request.body).not.toHaveProperty('mode')
  })

  it('keeps Muse cheap reference images out of the first-frame image field', () => {
    const request = buildRequestWithCapabilities('muse_video', {
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
      reference_image_urls: ['https://cdn.example.com/ref.png'],
    })
    expect(request.body).not.toHaveProperty('first_frame_image_url')
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

  it('normalizes completed MiniMax unified responses with a content URL', () => {
    const completed = parseVideoTaskSnapshot('video_tasks', {
      id: 'task-minimax',
      status: 'completed',
      duration: 5,
      metadata: { url: '/v1/videos/task-minimax/content' },
    })

    expect(completed.status).toBe('succeeded')
    expect(completed.durationSeconds).toBe(5)
    expect(completed.videoUrl).toBe('/v1/videos/task-minimax/content')
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
    expect(videoTaskPath('muse_video', 'task/muse', 'muse-cheap')).toBe('/videos/task%2Fmuse?model=muse-cheap')
  })

  it('keeps the exact MiniMax model when looking up unified tasks', () => {
    expect(videoTaskPath('video_tasks', 'task/minimax', 'minimax H3-self'))
      .toBe('/videos/task%2Fminimax?model=minimax%20H3-self')
  })

  it('routes Seedance video lookups with a model hint for composite keys', () => {
    expect(videoTaskPath('seedance_video', 'task/seedance', 'seedance-2.5'))
      .toBe('/videos/task%2Fseedance?model=seedance-2.5')
  })

  it('builds the unified Seedance video body with reference fields', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
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
    })
    expect(request.body).toHaveProperty('reference_image_urls', ['https://cdn.example.com/ref.png'])
  })

  it('uses reference-images mode for Seedance reference audio', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
      ...base,
      images: [{
        id: 1,
        kind: 'image',
        name: 'ref.png',
        url: 'https://cdn.example.com/ref.png',
        role: 'reference_image',
      }],
      audios: [{
        id: 2,
        kind: 'audio',
        name: 'ref.mp3',
        url: 'https://cdn.example.com/ref.mp3',
      }],
    })

    expect(request.body).toMatchObject({
      mode: 'reference-images',
      reference_image_urls: ['https://cdn.example.com/ref.png'],
      reference_audio_urls: ['https://cdn.example.com/ref.mp3'],
    })
    expect(request.body).not.toHaveProperty('reference_video_urls')
  })

  it('uses first/last frame URL fields for unified Seedance first-last-frame mode', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
      ...base,
      model: 'seedance-2.0',
      images: [
        { id: 1, kind: 'image', name: 'first.png', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
        { id: 2, kind: 'image', name: 'last.png', url: 'https://cdn.example.com/last.png', role: 'last_frame' },
      ],
    })

    expect(request.body).toMatchObject({
      mode: 'first-last-frame',
      first_frame_image_url: 'https://cdn.example.com/first.png',
      last_frame_image_url: 'https://cdn.example.com/last.png',
    })
    expect(request.body).not.toHaveProperty('images')
  })

  it('does not send first/last frame images alongside Seedance reference audio', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
      ...base,
      images: [
        { id: 1, kind: 'image', name: 'first.png', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
        { id: 2, kind: 'image', name: 'last.png', url: 'https://cdn.example.com/last.png', role: 'last_frame' },
      ],
      audios: [{ id: 3, kind: 'audio', name: 'ref.mp3', url: 'https://cdn.example.com/ref.mp3' }],
    })

    expect(request.body).toMatchObject({
      mode: 'reference-images',
      reference_image_urls: [
        'https://cdn.example.com/first.png',
        'https://cdn.example.com/last.png',
      ],
      reference_audio_urls: ['https://cdn.example.com/ref.mp3'],
    })
    expect(request.body).not.toHaveProperty('images')
  })

  it('does not send frame images alongside a Seedance reference video', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
      ...base,
      images: [
        { id: 1, kind: 'image', name: 'first.png', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
        { id: 2, kind: 'image', name: 'last.png', url: 'https://cdn.example.com/last.png', role: 'last_frame' },
      ],
      videos: [{ id: 3, kind: 'video', name: 'ref.mp4', url: 'https://cdn.example.com/ref.mp4' }],
    })

    expect(request.body).toMatchObject({
      mode: 'reference-video',
      reference_video_urls: ['https://cdn.example.com/ref.mp4'],
    })
    expect(request.body).not.toHaveProperty('images')
    expect(request.body.reference_image_urls).toEqual([
      'https://cdn.example.com/first.png',
      'https://cdn.example.com/last.png',
    ])
  })

  it('combines Seedance reference video and reference audio when both slots are enabled', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
      ...base,
      videos: [{ id: 1, kind: 'video', name: 'ref.mp4', url: 'https://cdn.example.com/ref.mp4' }],
      audios: [{ id: 2, kind: 'audio', name: 'ref.mp3', url: 'https://cdn.example.com/ref.mp3' }],
    })
    expect(request.body).toMatchObject({
      mode: 'reference-video',
      reference_video_urls: ['https://cdn.example.com/ref.mp4'],
      reference_audio_urls: ['https://cdn.example.com/ref.mp3'],
    })
  })

  it('submits minimax H3 through the unified video endpoint', () => {
    const model = 'minimax H3-self'
    const provider = resolveVideoProvider(model, { platform: 'openai' }, capabilityFor(model))
    const request = buildRequestWithCapabilities(provider, {
      ...base,
      model,
      durationSeconds: 5,
      resolution: '768p',
      aspectRatio: '9:16',
    })

    expect(provider).toBe('video_tasks')
    expect(request.path).toBe('/video/generations')
    expect(request.body).toMatchObject({
      model,
      duration: 5,
      resolution: '768p',
      aspect_ratio: '9:16',
    })
    expect(request.body).not.toHaveProperty('mode')
    expect(request.body).not.toHaveProperty('seconds')
    expect(request.body).not.toHaveProperty('generate_audio')
  })

  it('uses MiniMax reference-image fields when audio and first frames are present', () => {
    const request = buildRequestWithCapabilities('video_tasks', {
      ...base,
      model: 'minimax H3-self',
      images: [
        { id: 1, kind: 'image', name: 'first.png', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
      ],
      audios: [
        { id: 2, kind: 'audio', name: 'ref.mp3', url: 'https://cdn.example.com/ref.mp3' },
      ],
    })

    expect(request.body).toMatchObject({
      reference_image_urls: ['https://cdn.example.com/first.png'],
      reference_audio_urls: ['https://cdn.example.com/ref.mp3'],
    })
    expect(request.body).not.toHaveProperty('first_frame_image_url')
  })

  it('keeps image, video and audio references together in Seedance unified mode', () => {
    const request = buildRequestWithCapabilities('seedance_video', {
      ...base,
      generateAudio: false,
      images: [
        { id: 1, kind: 'image', name: 'first.png', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
        { id: 2, kind: 'image', name: 'last.png', url: 'https://cdn.example.com/last.png', role: 'last_frame' },
        { id: 3, kind: 'image', name: 'ref.png', url: 'https://cdn.example.com/ref.png', role: 'reference_image' },
      ],
      videos: [{ id: 4, kind: 'video', name: 'ref.mp4', url: 'https://cdn.example.com/ref.mp4', role: 'video_edit' }],
      audios: [{ id: 5, kind: 'audio', name: 'ref.mp3', url: 'https://cdn.example.com/ref.mp3' }],
    })
    expect(request.body).toMatchObject({
      mode: 'reference-video',
      reference_video_urls: ['https://cdn.example.com/ref.mp4'],
      reference_audio_urls: ['https://cdn.example.com/ref.mp3'],
    })
    expect(request.body.reference_image_urls).toEqual([
      'https://cdn.example.com/first.png',
      'https://cdn.example.com/last.png',
      'https://cdn.example.com/ref.png',
    ])
  })

  it('routes Grok video edits and extensions to their documented endpoints', () => {
    const edit = buildRequestWithCapabilities('grok', {
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
    expect(edit.path).toBe('/video/generations')
    expect(edit.body).toMatchObject({
      mode: 'video-edit',
      reference_video_url: 'https://cdn.example.com/source.mp4',
    })
    expect(edit.body).not.toHaveProperty('video')

    const extension = buildRequestWithCapabilities('grok', {
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
    expect(extension.path).toBe('/video/generations')
    expect(extension.body).toMatchObject({
      mode: 'video-extension',
      reference_video_url: 'https://cdn.example.com/source.mp4',
    })
    expect(extension.body).not.toHaveProperty('video')
  })

  it('does not attach frame images to a Grok reference-video request', () => {
    const request = buildRequestWithCapabilities('grok', {
      ...base,
      model: 'grok-imagine-video-1.5',
      images: [
        { id: 1, kind: 'image', name: 'first.png', url: 'https://cdn.example.com/first.png', role: 'first_frame' },
      ],
      videos: [
        { id: 2, kind: 'video', name: 'ref.mp4', url: 'https://cdn.example.com/ref.mp4' },
      ],
    })

    expect(request.body).toMatchObject({
      mode: 'reference-video',
      reference_video_urls: ['https://cdn.example.com/ref.mp4'],
    })
    expect(request.body).not.toHaveProperty('first_frame_image_url')
    expect(request.body.reference_image_urls).toEqual(['https://cdn.example.com/first.png'])
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
