import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  persistableImageGenerationRequest,
  serializeImageGenerationBody,
} from '../imageGenerationWorker'

const currentDir = dirname(fileURLToPath(import.meta.url))
const workerSource = readFileSync(
  resolve(currentDir, '../../../public/generation-sw.js'),
  'utf8',
)

describe('image generation worker persistence', () => {
  it('serializes JSON request bodies without losing their content', () => {
    const body = serializeImageGenerationBody('{"prompt":"窗边的小猫"}')
    expect(body).toEqual({ kind: 'text', text: '{"prompt":"窗边的小猫"}' })
  })

  it('serializes multipart bodies so a reference image can be replayed after reload', () => {
    const form = new FormData()
    form.append('prompt', '一张海报')
    form.append('image', new Blob(['pixels'], { type: 'image/png' }), 'reference.png')

    const body = serializeImageGenerationBody(form)

    expect(body.kind).toBe('form')
    if (body.kind !== 'form') return
    expect(body.entries.find((entry) => entry.name === 'prompt')?.value).toBe('一张海报')
    const image = body.entries.find((entry) => entry.name === 'image')?.value
    expect(image).toBeInstanceOf(Blob)
    expect((image as Blob).type).toBe('image/png')
  })

  it('persists the full request, retry window, and task identifiers', () => {
    const request = persistableImageGenerationRequest({
      id: 'task-1',
      url: '/v1/images/generations',
      init: {
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test' },
        body: '{"prompt":"test"}',
      },
      createdAt: 1234,
    })

    expect(request).toEqual({
      id: 'task-1',
      url: '/v1/images/generations',
      init: {
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test' },
        body: { kind: 'text', text: '{"prompt":"test"}' },
      },
      createdAt: 1234,
    })
  })

  it('only retries queued tasks and fails ambiguous processing tasks closed', () => {
    expect(workerSource).toContain('recoverTasks(taskIds)')
    expect(workerSource).toContain('task.request.url')
    expect(workerSource).toContain('attempts')
    expect(workerSource).toContain('nextRetryAt')
    expect(workerSource).toContain('isRetryableStatus')
    expect(workerSource).not.toContain('status >= 500')
    expect(workerSource).toContain("status: 'queued'")
    expect(workerSource).toContain("task.status === 'processing'")
    expect(workerSource).toContain('为避免重复扣费未自动重试')
  })

  it('keeps the browser worker and retry window at five minutes', () => {
    expect(workerSource).toContain('const TASK_TIMEOUT_MS = 5 * 60 * 1000')
    expect(workerSource).toContain('const RETRY_WINDOW_MS = 5 * 60 * 1000')
  })
})
