import { describe, expect, it } from 'vitest'

import { extractGeminiImageResults } from '../geminiImageResults'

function candidate(parts: unknown[]) {
  return { candidates: [{ content: { parts }, finishReason: 'STOP' }] }
}

describe('extractGeminiImageResults', () => {
  it('extracts camelCase inline images', () => {
    expect(extractGeminiImageResults(candidate([
      { inlineData: { mimeType: 'image/png', data: 'YWJj' } },
    ]))).toEqual([{ b64_json: 'YWJj', mimeType: 'image/png' }])
  })

  it('extracts snake_case inline images', () => {
    expect(extractGeminiImageResults(candidate([
      { inline_data: { mime_type: 'image/webp', data: 'YWJj' } },
    ]))).toEqual([{ b64_json: 'YWJj', mimeType: 'image/webp' }])
  })

  it('extracts fileData image URLs', () => {
    expect(extractGeminiImageResults(candidate([
      { fileData: { mimeType: 'image/jpeg', fileUri: 'https://img.example.test/a.jpg' } },
    ]))).toEqual([{ url: 'https://img.example.test/a.jpg', mimeType: 'image/jpeg' }])
  })

  it('extracts image URLs embedded in text', () => {
    expect(extractGeminiImageResults(candidate([
      { text: 'Generated: https://img.example.test/a.png' },
    ]))).toEqual([{ url: 'https://img.example.test/a.png', mimeType: 'image/png' }])
  })

  it('handles wrapped response candidates without duplicating representations', () => {
    const payload = {
      response: candidate([
        { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } },
        { fileData: { mimeType: 'image/jpeg', fileUri: 'https://img.example.test/a.jpg' } },
        { text: 'https://img.example.test/a.jpg' },
      ]),
    }
    expect(extractGeminiImageResults(payload)).toEqual([{ b64_json: 'YWJj', mimeType: 'image/jpeg' }])
  })
})
