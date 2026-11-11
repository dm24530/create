import { describe, expect, it } from 'vitest'
import {
  buildEditForm,
  buildEditURLPayload,
  buildGeminiPayload,
  buildGeminiURL,
  buildImageGenerationPayload,
  extractImages,
  geminiAspectRatio,
} from '../imageRequestBuilder'
import type { SizeSettings } from '../imageStudioTypes'

const appliedSize: SizeSettings = {
  mode: 'custom',
  aspectBase: 1024,
  aspectRatio: '1:1',
  useCustomRatio: false,
  customRatioWidth: 1,
  customRatioHeight: 1,
  width: 1600,
  height: 900,
}

describe('image request builder', () => {
  it('builds a Gemini URL from the configured API root', () => {
    expect(buildGeminiURL(
      'https://api.example.com/v1',
      'gemini-image-model',
      'openai',
    )).toBe(
      'https://api.example.com/v1beta/models/gemini-image-model:generateContent',
    )
    expect(buildGeminiURL(
      'https://api.example.com/v1',
      'gemini-image-model',
      'antigravity',
    )).toBe(
      'https://api.example.com/antigravity/v1beta/models/gemini-image-model:generateContent',
    )
  })

  it('derives a reduced aspect ratio from custom dimensions', () => {
    expect(geminiAspectRatio('1600x900', appliedSize)).toBe('16:9')
    expect(geminiAspectRatio('auto', {
      ...appliedSize,
      mode: 'ratio',
      useCustomRatio: true,
      customRatioWidth: 4,
      customRatioHeight: 3,
    })).toBe('4:3')
  })

  it('builds Gemini contents with remote, inline, and text references', () => {
    const payload = buildGeminiPayload('prompt', [
      {
        name: 'remote.png',
        blob: new Blob(),
        mimeType: 'image/png',
        dataUrl: '',
        remoteUrl: 'https://cdn.example.com/remote.png',
      },
      {
        name: 'inline.png',
        blob: new Blob(),
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,AAAA',
      },
      {
        name: 'fallback.png',
        blob: new Blob(),
        mimeType: 'image/png',
        dataUrl: '',
      },
    ], {
      size: '1600x900',
      quality: 'high',
      appliedSize,
    })

    expect(payload.contents[0].parts).toEqual([
      { text: '图片1' },
      {
        fileData: {
          mimeType: 'image/png',
          fileUri: 'https://cdn.example.com/remote.png',
        },
      },
      { text: '图片2' },
      { inlineData: { mimeType: 'image/webp', data: 'AAAA' } },
      { text: '图片3' },
      { text: 'fallback.png' },
      { text: 'prompt' },
    ])
    expect(payload.generationConfig.imageConfig).toEqual({
      aspectRatio: '16:9',
      imageSize: '4K',
    })
  })

  it('builds URL-based edit payloads with explicit request settings', () => {
    expect(buildEditURLPayload(
      'edit prompt',
      ['https://cdn.example.com/one.png'],
      {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'high',
        format: 'png',
        background: 'auto',
      },
    )).toEqual({
      model: 'gpt-image-1',
      prompt: 'edit prompt',
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      background: 'auto',
      n: 1,
      response_format: 'url',
      images: [{ image_url: 'https://cdn.example.com/one.png' }],
    })
  })

  it('requests URL results for GPT image generation and keeps b64 for other models', () => {
    const settings = {
      model: 'gpt-image-2-5-sunburst',
      size: '1024x1024',
      quality: 'high',
      format: 'png',
      background: 'auto',
    }
    expect(buildImageGenerationPayload('draw a fox', settings)).toEqual({
      model: 'gpt-image-2-5-sunburst',
      prompt: 'draw a fox',
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      background: 'auto',
      n: 1,
      response_format: 'url',
    })
    expect(buildImageGenerationPayload('draw a fox', {
      ...settings,
      model: 'flux-pro',
    }).response_format).toBe('b64_json')
  })

  it('builds multipart edits with normalized reference names', () => {
    const form = buildEditForm(
      'edit prompt',
      [{
        name: 'portrait.png',
        blob: new Blob(['image']),
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
      }],
      {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'high',
        format: 'png',
        background: 'auto',
      },
      [],
    )

    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('prompt')).toBe('edit prompt')
    expect(form.get('response_format')).toBe('url')
    const image = form.get('image[]') as File
    expect(image.name).toBe('portrait.webp')
  })

  it('extracts nested result shapes', () => {
    expect(extractImages({
      data: [
        {
          b64_json: 'AAAA',
        },
      ],
    })).toEqual([{ b64_json: 'AAAA' }])
    expect(extractImages({
      response: {
        output: [{ type: 'image_generation_call', result: 'BBBB' }],
      },
    })).toEqual([{ type: 'image_generation_call', result: 'BBBB' }])
  })
})
