import type { PlazaModel } from '@/api/modelPlaza'
import { getVideoModelProfile, isVideoModel } from '@/features/video-studio/videoStudioApi'

export function isVideoPricingModel(model: PlazaModel): boolean {
  return model.pricing?.billing_mode === 'video' || Boolean(model.video_capabilities) || isVideoModel(model.name)
}

export function videoBillingUnit(model: PlazaModel): 'second' | 'request' {
  return model.pricing?.billing_mode === 'video' ? 'second' : 'request'
}

function formatDurationOptions(options: readonly number[]): string {
  const values = Array.from(new Set(options.filter((value) => Number.isFinite(value) && value > 0))).sort((a, b) => a - b)
  if (!values.length) return '-'
  const parts: string[] = []
  for (let index = 0; index < values.length;) {
    let end = index
    while (end + 1 < values.length && values[end + 1] === values[end] + 1) end += 1
    if (end - index >= 2) {
      parts.push(`${values[index]}–${values[end]}s`)
    } else {
      for (let valueIndex = index; valueIndex <= end; valueIndex += 1) parts.push(`${values[valueIndex]}s`)
    }
    index = end + 1
  }
  return parts.join(' / ')
}

export function videoDurationLabel(model: PlazaModel): string {
  const profile = getVideoModelProfile(model.name, undefined, model.video_capabilities)
  if (profile.durationOptions?.length) return formatDurationOptions(profile.durationOptions)
  return profile.minDuration === profile.maxDuration
    ? `${profile.maxDuration}s`
    : `${profile.minDuration}–${profile.maxDuration}s`
}

export function videoPreviewDurations(model: PlazaModel): number[] {
  const profile = getVideoModelProfile(model.name, undefined, model.video_capabilities)
  if (profile.durationOptions?.length) {
    const values = Array.from(new Set(profile.durationOptions)).sort((a, b) => a - b)
    return values.length > 1 ? [values[0], values[values.length - 1]] : values
  }
  return Array.from(new Set([profile.minDuration, profile.maxDuration]))
}

export function videoCapabilityKeys(model: PlazaModel): string[] {
  const profile = getVideoModelProfile(model.name, undefined, model.video_capabilities)
  const keys: string[] = []
  const modes = new Set(profile.modes)
  if (modes.has('text-to-video')) keys.push('textToVideo')
  if (modes.has('image-to-video') || modes.has('first-last-frame')) keys.push('imageToVideo')
  if (modes.has('reference-images')) keys.push('referenceImages')
  if (modes.has('reference-video')) keys.push('referenceVideo')
  if (modes.has('video-edit') || modes.has('video-extension')) keys.push('videoEdit')
  if (profile.maxAudios > 0) keys.push('referenceAudio')
  return keys
}

export function videoReferenceSummary(model: PlazaModel): { images: number; videos: number; audios: number } {
  const profile = getVideoModelProfile(model.name, undefined, model.video_capabilities)
  return {
    images: profile.maxImages,
    videos: profile.maxVideos,
    audios: profile.maxAudios,
  }
}

export function videoModelDescriptionKey(model: PlazaModel): string {
  const name = model.name.toLowerCase()
  if (name.includes('muse')) return 'muse'
  if (name.includes('grok')) return 'grok'
  if (name.includes('wan3.0')) return 'wan'
  if (name.includes('minimax')) return 'minimax'
  if (name.includes('seedance')) return 'seedance'
  return 'generic'
}
