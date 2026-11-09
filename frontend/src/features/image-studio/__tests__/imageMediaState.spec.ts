import { describe, expect, it } from 'vitest'
import {
  isAnimatedImageSource,
  resolveImageMediaSource,
} from '../imageMediaState'

describe('image media state', () => {
  it('recognizes animated GIFs from format, data URL, and file extension', () => {
    expect(isAnimatedImageSource(
      { id: 1, format: 'gif', src: 'https://cdn.example.com/image.png' },
      'gif',
    )).toBe(true)
    expect(isAnimatedImageSource(
      { id: 2, src: 'data:image/gif;base64,AAAA' },
      'gif',
    )).toBe(true)
    expect(isAnimatedImageSource(
      { id: 3, src: 'https://cdn.example.com/animation.gif?token=1' },
      'gif',
    )).toBe(true)
  })

  it('prefers thumbnails for static images and originals for animations', () => {
    expect(resolveImageMediaSource({
      id: 1,
      src: 'https://cdn.example.com/original.png',
      thumbSrc: 'https://cdn.example.com/thumb.png',
      format: 'png',
    }, 0, 'gif')).toBe('https://cdn.example.com/thumb.png')

    expect(resolveImageMediaSource({
      id: 2,
      src: 'https://cdn.example.com/original.gif',
      thumbSrc: 'https://cdn.example.com/thumb.png',
      format: 'gif',
    }, 0, 'gif')).toBe('https://cdn.example.com/original.gif')
  })

  it('adds a retry nonce only to remote media URLs', () => {
    expect(resolveImageMediaSource({
      id: 1,
      src: 'https://cdn.example.com/image.png',
    }, 2, 'gif', 'https://app.example.com')).toBe(
      'https://cdn.example.com/image.png?_retry=2',
    )
    expect(resolveImageMediaSource({
      id: 1,
      src: 'data:image/png;base64,AAAA',
    }, 2, 'gif', 'https://app.example.com')).toBe(
      'data:image/png;base64,AAAA',
    )
  })
})
