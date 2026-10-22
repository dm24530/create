import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const layoutDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
)
const layoutPath = resolve(layoutDir, 'AppLayout.vue')
const userNavPath = resolve(layoutDir, 'UserNav.vue')
const studioNavPath = resolve(layoutDir, 'StudioNav.vue')
const sidebarPath = resolve(layoutDir, 'AppSidebar.vue')
const canvasHostPath = resolve(layoutDir, '../../features/infinite-canvas/CanvasHostView.vue')
const componentSource = readFileSync(layoutPath, 'utf8')

describe('AppLayout navigation', () => {
  it('keeps the inline studio navigation and horizontal user navigation mutually exclusive', () => {
    expect(componentSource).toContain('v-if="showInlineStudioNav"')
    expect(componentSource).toContain('v-if="usesHorizontalUserLayout"')
    expect(componentSource).toContain(
      'const showInlineStudioNav = computed(() => showStudioNav.value && !usesHorizontalUserLayout.value)',
    )
    expect(componentSource).not.toContain('v-if="showStudioNav"')
  })

  it('does not expose the infinite canvas entry in user navigation', () => {
    const userNav = readFileSync(userNavPath, 'utf8')
    const studioNav = readFileSync(studioNavPath, 'utf8')
    const sidebar = readFileSync(sidebarPath, 'utf8')

    expect(userNav).not.toContain('to="/canvas"')
    expect(studioNav).not.toContain('to="/canvas"')
    expect(sidebar).not.toContain("path: '/canvas'")
  })

  it('forwards the host theme to the embedded canvas', () => {
    const canvasHost = readFileSync(canvasHostPath, 'utf8')

    expect(canvasHost).toContain('type: \'create-canvas-theme\'')
    expect(canvasHost).toContain('watch(isDark, postTheme)')
  })
})
