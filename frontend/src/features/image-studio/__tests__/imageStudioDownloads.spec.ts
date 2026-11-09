import { describe, expect, it } from 'vitest'
import {
  imageDownloadFilename,
  imageDownloadMenuPosition,
} from '../imageStudioDownloads'

describe('image studio downloads', () => {
  it('builds a stable filename from the image title and format', () => {
    expect(imageDownloadFilename({
      id: 1,
      title: '生成结果 1',
      src: '',
      meta: '',
      format: 'webp',
    })).toBe('生成结果 1.webp')
    expect(imageDownloadFilename({
      id: 1,
      title: 'result',
      src: '',
      meta: '',
    })).toBe('result.png')
  })

  it('keeps the download menu inside the viewport', () => {
    expect(imageDownloadMenuPosition(2, 3, 1024, 768)).toEqual({
      x: 8,
      y: 8,
    })
    expect(imageDownloadMenuPosition(1020, 760, 1024, 768)).toEqual({
      x: 808,
      y: 682,
    })
  })
})
