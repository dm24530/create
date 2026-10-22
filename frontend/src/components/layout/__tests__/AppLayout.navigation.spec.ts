import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const componentPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../AppLayout.vue',
)
const componentSource = readFileSync(componentPath, 'utf8')

describe('AppLayout navigation', () => {
  it('keeps the inline studio navigation and horizontal user navigation mutually exclusive', () => {
    expect(componentSource).toContain('v-if="showInlineStudioNav"')
    expect(componentSource).toContain('v-if="usesHorizontalUserLayout"')
    expect(componentSource).toContain(
      'const showInlineStudioNav = computed(() => showStudioNav.value && !usesHorizontalUserLayout.value)',
    )
    expect(componentSource).not.toContain('v-if="showStudioNav"')
  })
})
