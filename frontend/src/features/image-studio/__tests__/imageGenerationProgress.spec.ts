import { describe, expect, it, vi } from 'vitest'
import { createImageGenerationProgress } from '../imageGenerationProgress'
import type { GeneratedImage } from '../imageStudioTypes'

const image: GeneratedImage = {
  id: 1,
  title: 'pending',
  src: '',
  meta: 'PNG',
  pending: true,
  taskId: 'task-1',
}

describe('image generation progress', () => {
  it('processes one logical image only once', async () => {
    const finishBatch = vi.fn(async () => [{
      ...image,
      id: 2,
      title: 'result',
      src: 'https://cdn.example.com/result.png',
      pending: false,
    }])
    const persistBatch = vi.fn(async () => false)
    const progress = createImageGenerationProgress({
      owner: { epoch: 1, userId: '7' },
      isOwnerCurrent: () => true,
      finishBatch,
      persistBatch,
      loadGallery: async () => undefined,
      loadQuota: async () => undefined,
      resolvePrompt: () => 'prompt',
      resolveModel: () => 'gpt-image-1',
    })

    progress.enqueue(image, {
      status: 'fulfilled',
      value: [{ url: 'https://cdn.example.com/result.png' }],
    })
    progress.enqueue(image, {
      status: 'fulfilled',
      value: [{ url: 'https://cdn.example.com/result.png' }],
    })
    await progress.drain()

    expect(finishBatch).toHaveBeenCalledTimes(1)
    expect(persistBatch).toHaveBeenCalledTimes(1)
    expect(progress.generatedCount).toBe(1)
    expect(progress.completedIds.has(1)).toBe(true)
  })
})
