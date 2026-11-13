import { describe, expect, it } from 'vitest'

import {
  canvasPathFromLocation,
  canvasPathFromVueRoute,
  isCanvasRoutePath,
  normalizeCanvasRoutePath,
} from '../canvasRouteSync'

describe('canvas route sync', () => {
  it('builds a project URL while removing iframe-only query parameters', () => {
    expect(canvasPathFromLocation(
      '/canvas/project-1',
      '?embed=1&user=101&scope=abc&mode=recent',
      '#agent',
    )).toBe('/canvas/project-1?mode=recent#agent')
  })

  it('builds the canvas frame route from the host route', () => {
    expect(canvasPathFromVueRoute(
      '/canvas/project-1',
      'project-1',
      { embed: '1', user: '101', scope: 'abc', mode: 'new' },
      '#agent',
    )).toBe('/canvas/project-1?mode=new#agent')
  })

  it('normalizes only managed canvas paths', () => {
    expect(normalizeCanvasRoutePath('/canvas/project-2?mode=recent#agent'))
      .toBe('/canvas/project-2?mode=recent#agent')
    expect(normalizeCanvasRoutePath('/image-studio')).toBe('')
    expect(normalizeCanvasRoutePath('https://example.com/canvas/project-2')).toBe('')
    expect(isCanvasRoutePath('/canvas/project-2')).toBe(true)
    expect(isCanvasRoutePath('/canvasish')).toBe(false)
  })
})
