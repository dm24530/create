import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { VideoModelCapabilities } from '@/api/channels'
import {
  buildVideoRequest,
  getVideoModelProfile,
  resolveVideoProvider,
  type VideoReferenceAsset,
} from '../videoStudioApi'

interface CatalogEntry {
  model_name: string
  capabilities: VideoModelCapabilities
}

function loadCatalog(): CatalogEntry[] {
  const path = resolve(process.cwd(), '../backend/migrations/276_channel_video_capabilities.sql')
  const sql = readFileSync(path, 'utf8')
  const start = sql.indexOf('$catalog$') + '$catalog$'.length
  const end = sql.indexOf('$catalog$::jsonb', start)
  if (start < '$catalog$'.length || end < 0) throw new Error('video capability catalog not found')
  return JSON.parse(sql.slice(start, end)) as CatalogEntry[]
}

const catalog = loadCatalog()

function referenceAssets(capabilities: VideoModelCapabilities): {
  images: VideoReferenceAsset[]
  videos: VideoReferenceAsset[]
  audios: VideoReferenceAsset[]
} {
  const images: VideoReferenceAsset[] = []
  let nextID = 1
  if (capabilities.slots.first_frame > 0) {
    images.push({ id: nextID++, kind: 'image', name: 'first.png', url: 'https://cdn.example/first.png', role: 'first_frame' })
  }
  if (capabilities.slots.last_frame > 0) {
    images.push({ id: nextID++, kind: 'image', name: 'last.png', url: 'https://cdn.example/last.png', role: 'last_frame' })
  }
  if (capabilities.slots.reference_image > 0) {
    images.push({ id: nextID++, kind: 'image', name: 'ref.png', url: 'https://cdn.example/ref.png', role: 'reference_image' })
  }
  return {
    images,
    videos: capabilities.slots.reference_video > 0
      ? [{ id: nextID++, kind: 'video', name: 'ref.mp4', url: 'https://cdn.example/ref.mp4' }]
      : [],
    audios: capabilities.slots.reference_audio > 0
      ? [{ id: nextID++, kind: 'audio', name: 'ref.mp3', url: 'https://cdn.example/ref.mp3' }]
      : [],
  }
}

describe('all video models synthetic smoke', () => {
  it('contains the complete current catalog', () => {
    expect(catalog).toHaveLength(23)
    expect(new Set(catalog.map((entry) => entry.model_name)).size).toBe(23)
  })

  describe.each(catalog.map((entry) => [entry.model_name, entry] as const))('%s', (_name, entry) => {
    it('routes, describes and builds a supported request', () => {
      const capabilities = entry.capabilities
      const provider = resolveVideoProvider(entry.model_name, { platform: 'openai' }, capabilities)
      expect(provider).toBe(capabilities.protocol)

      const profile = getVideoModelProfile(entry.model_name, provider, capabilities)
      expect(profile.minDuration).toBeGreaterThan(0)
      expect(profile.maxDuration).toBeGreaterThanOrEqual(profile.minDuration)
      expect(profile.defaultDuration).toBeGreaterThanOrEqual(profile.minDuration)
      expect(profile.defaultDuration).toBeLessThanOrEqual(profile.maxDuration)
      expect(profile.resolutions.length).toBeGreaterThan(0)
      expect(profile.aspectRatios.length).toBeGreaterThan(0)
      if (profile.durationOptions?.length) expect(profile.durationOptions).toContain(profile.defaultDuration)

      const references = referenceAssets(capabilities)
      const request = buildVideoRequest(provider, {
        model: entry.model_name,
        prompt: 'synthetic smoke prompt',
        durationSeconds: profile.defaultDuration,
        durationAuto: false,
        resolution: profile.resolutions[0],
        aspectRatio: profile.aspectRatios[0],
        generateAudio: profile.supportsAudio,
        ...references,
      }, capabilities)

      expect(request.body.model).toBe(entry.model_name)
      if (provider === 'seedance') {
        expect(request.path).toBe('/contents/generations/tasks')
        expect(Array.isArray(request.body.content)).toBe(true)
        expect(request.body.ratio).toBe(profile.aspectRatios[0])
      } else {
        expect(request.path).toBe('/video/generations')
        expect(request.body.prompt).toBe('synthetic smoke prompt')
        expect(request.body.resolution).toBe(profile.resolutions[0])
        expect(request.body.aspect_ratio).toBe(profile.aspectRatios[0])
      }

      if (capabilities.reference_image_extra_price && capabilities.reference_image_extra_price > 0) {
        expect(capabilities.reference_image_free_count).toBeGreaterThan(0)
      }
      if (capabilities.reference_video_billing_mode && capabilities.reference_video_billing_mode !== 'off') {
        expect(capabilities.slots.reference_video).toBeGreaterThan(0)
      }
    })
  })
})
