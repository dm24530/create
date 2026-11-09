import { describe, expect, it } from 'vitest'
import {
  allocateImageBatchDisplayOrder,
  createPendingImageBatch,
  failImageTask,
  normalizeImageRequestCount,
  removePendingTaskImages,
} from '../imageGenerationQueue'

describe('image generation queue', () => {
  it('clamps image request counts to the supported range', () => {
    expect(normalizeImageRequestCount(0)).toBe(1)
    expect(normalizeImageRequestCount(3)).toBe(3)
    expect(normalizeImageRequestCount(9)).toBe(4)
  })

  it('allocates a monotonic display-order range for each batch', () => {
    const allocation = allocateImageBatchDisplayOrder(1_000, 2_000, 3)
    expect(allocation.order).toBe(2_000_000)
    expect(allocation.nextCursor).toBe(2_000_000)
  })

  it('creates one stable task and slot per requested image', () => {
    let nextId = 7
    let nextTask = 0
    const { images, nextImageId } = createPendingImageBatch({
      count: 2,
      nextImageId: nextId,
      createTaskId: () => `task-${++nextTask}`,
      batchId: 'batch-1',
      apiKeyId: 9,
      startedAt: 1_000,
      displayOrderBase: 5_000,
      prompt: 'prompt',
      model: 'gpt-image-1',
      size: '1024x1024',
      quality: 'high',
      format: 'png',
      background: 'auto',
      customSizeRequested: false,
      hadReferences: true,
    })

    expect(nextImageId).toBe(9)
    expect(images).toHaveLength(2)
    expect(images.map((image) => image.taskId)).toEqual(['task-1', 'task-2'])
    expect(images.map((image) => image.displayOrder)).toEqual([5_000, 4_999])
    expect(images.every((image) => image.pending)).toBe(true)
    expect(images.every((image) => image.batchId === 'batch-1')).toBe(true)
  })

  it('clears media and marks a task failed without losing timing', () => {
    const image = createPendingImageBatch({
      count: 1,
      nextImageId: 1,
      createTaskId: () => 'task-1',
      batchId: 'batch-1',
      apiKeyId: 9,
      startedAt: 1_000,
      displayOrderBase: 5_000,
      prompt: 'prompt',
      model: 'gpt-image-1',
      size: '1024x1024',
      quality: 'high',
      format: 'png',
      background: 'auto',
      customSizeRequested: false,
      hadReferences: false,
    }).images[0]
    image.previewSrc = 'blob:preview'
    image.thumbSrc = 'thumb'

    failImageTask(image, 'upstream failed', 4_000)

    expect(image).toMatchObject({
      pending: false,
      failed: true,
      error: 'upstream failed',
      title: '生成失败',
      src: '',
      previewSrc: undefined,
      thumbSrc: undefined,
      durationMs: 3_000,
    })
  })

  it('removes only unresolved pending tasks that are not retained', () => {
    const images = [
      { id: 1, pending: true },
      { id: 2, pending: true },
      { id: 3, pending: false },
    ]
    expect(removePendingTaskImages(
      images,
      [{ id: 1, pending: true }, { id: 2, pending: true }],
      new Set([2]),
    )).toEqual([
      { id: 2, pending: true },
      { id: 3, pending: false },
    ])
  })
})
