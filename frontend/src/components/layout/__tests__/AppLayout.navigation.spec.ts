import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const layoutDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
)
const appPath = resolve(layoutDir, '../../App.vue')
const layoutPath = resolve(layoutDir, 'AppLayout.vue')
const userNavPath = resolve(layoutDir, 'UserNav.vue')
const studioNavPath = resolve(layoutDir, 'StudioNav.vue')
const sidebarPath = resolve(layoutDir, 'AppSidebar.vue')
const canvasHostPath = resolve(layoutDir, '../../features/infinite-canvas/CanvasHostView.vue')
const canvasMainPath = resolve(layoutDir, '../../../../canvas-app/src/main.tsx')
const canvasTopBarPath = resolve(layoutDir, '../../../../canvas-app/src/components/canvas/canvas-top-bar.tsx')
const canvasProjectPath = resolve(layoutDir, '../../../../canvas-app/src/pages/canvas/project.tsx')
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

  it('exposes the Create entry once in each navigation surface', () => {
    const userNav = readFileSync(userNavPath, 'utf8')
    const studioNav = readFileSync(studioNavPath, 'utf8')
    const sidebar = readFileSync(sidebarPath, 'utf8')

    expect(userNav.match(/to="\/canvas"/g)).toHaveLength(1)
    expect(studioNav.match(/to="\/canvas"/g)).toHaveLength(1)
    expect(sidebar.match(/path: '\/canvas'/g)).toHaveLength(1)
    expect(userNav).toContain('v-if="showCanvas"')
    expect(studioNav).toContain('v-if="showCanvas"')
    expect(sidebar).toContain('featureFlag: flagCanvasVisible')
  })

  it('forwards the host theme to the embedded canvas', () => {
    const canvasHost = readFileSync(canvasHostPath, 'utf8')

    expect(canvasHost).toContain('type: \'create-canvas-theme\'')
    expect(canvasHost).toContain('watch(isDark, postTheme)')
  })

  it('renders the embedded canvas before platform configuration finishes', () => {
    const canvasHost = readFileSync(canvasHostPath, 'utf8')
    const canvasMain = readFileSync(canvasMainPath, 'utf8')
    const appSource = readFileSync(appPath, 'utf8')

    expect(canvasHost).toContain("url.searchParams.set('embed', '1')")
    expect(canvasHost).toContain('create-canvas-ready')
    expect(canvasHost).toContain('v-if="frameURL"')
    expect(canvasHost).toContain('v-else-if="!frameURL || !frameReady"')
    expect(appSource).toContain('<CanvasHostView />')
    expect(appSource).toContain('v-show="isCanvasRoute"')
    expect(canvasMain).not.toContain('bootstrapManagedConfigFromParent().finally')
    expect(canvasMain).toContain('setManagedMode(true)')
    expect(canvasMain).toContain('notifyManagedCanvasReady')
    expect(canvasMain).toContain('[0, 100, 300, 800, 1500, 3000]')
  })

  it('keeps the route cache mounted when switching to a non-cached page', () => {
    const appSource = readFileSync(appPath, 'utf8')

    expect(appSource).toContain('<KeepAlive>')
    expect(appSource).not.toContain('<KeepAlive v-if=')
    expect(appSource).toContain('v-if="currentRoute.meta.keepAlive"')
    expect(appSource).toContain('v-if="!currentRoute.meta.keepAlive"')
  })

  it('does not expose the local Codex Agent in the canvas toolbar', () => {
    const canvasTopBar = readFileSync(canvasTopBarPath, 'utf8')
    const canvasProject = readFileSync(canvasProjectPath, 'utf8')

    expect(canvasTopBar).not.toContain('CompactAgentStatus')
    expect(canvasTopBar).not.toContain('>Agent<')
    expect(canvasProject).not.toContain('openAgentPanel')
  })
})
