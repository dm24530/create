import type { GeneratedImage } from './imageStudioTypes'
import {
  ImageGenerationStillRunning,
} from '@/utils/imageGenerationWorker'
import { ImageSubmissionUnconfirmed } from './imageSubmissionErrors'

export interface GenerationOwnerSnapshot {
  epoch: number
  userId: string
}

export type GenerationResultHandler = (
  image: GeneratedImage,
  result: PromiseSettledResult<any[]>,
) => Promise<void>

interface GenerationProgressOptions {
  owner: GenerationOwnerSnapshot
  isOwnerCurrent: (owner: GenerationOwnerSnapshot) => boolean
  finishBatch: (
    images: GeneratedImage[],
    results: PromiseSettledResult<any[]>[],
    titleStart: number,
  ) => Promise<GeneratedImage[]>
  persistBatch: (
    generated: GeneratedImage[],
    prompt: string,
    model: string,
  ) => Promise<boolean>
  loadGallery: () => Promise<unknown>
  loadQuota: () => Promise<unknown>
  resolvePrompt: (image: GeneratedImage) => string
  resolveModel: (image: GeneratedImage) => string
}

export function createImageGenerationProgress(options: GenerationProgressOptions) {
  const completedIds = new Set<GeneratedImage['id']>()
  const inFlightIds = new Set<GeneratedImage['id']>()
  let generatedCount = 0
  let firstError: unknown = null
  let stillRunning = false
  let queue = Promise.resolve()
  let persistenceQueue = Promise.resolve()
  let persistenceNeedsRefresh = false

  const recordError = (error: unknown) => {
    if (error instanceof ImageSubmissionUnconfirmed) return
    if (error instanceof ImageGenerationStillRunning) {
      stillRunning = true
      return
    }
    if (!firstError) firstError = error
  }

  const enqueue: GenerationResultHandler = (image, result) => {
    if (!options.isOwnerCurrent(options.owner)) return queue
    if (completedIds.has(image.id) || inFlightIds.has(image.id)) return queue
    inFlightIds.add(image.id)
    queue = queue.then(async () => {
      if (result.status === 'rejected') {
        if (result.reason instanceof ImageGenerationStillRunning) {
          stillRunning = true
          return
        }
        recordError(result.reason)
        return
      }
      if (!result.value.length) {
        recordError(new Error('上游没有返回图片'))
        return
      }
      const generated = await options.finishBatch(
        [image],
        [result],
        generatedCount + 1,
      )
      if (!generated.length) {
        recordError(new Error('上游没有返回可用图片'))
        return
      }
      completedIds.add(image.id)
      generatedCount += generated.length
      persistenceQueue = persistenceQueue
        .then(async () => {
          const saved = await options.persistBatch(
            generated,
            options.resolvePrompt(image),
            options.resolveModel(image),
          )
          if (saved) persistenceNeedsRefresh = true
        })
        .catch(recordError)
    }).catch((error) => {
      recordError(error)
    }).finally(() => {
      inFlightIds.delete(image.id)
    })
    return queue
  }

  return {
    completedIds,
    enqueue,
    recordError,
    drain: async () => {
      await queue
      await persistenceQueue
      if (persistenceNeedsRefresh) {
        await Promise.allSettled([options.loadGallery(), options.loadQuota()])
      }
    },
    get generatedCount() {
      return generatedCount
    },
    get firstError() {
      return firstError
    },
    get stillRunning() {
      return stillRunning
    },
  }
}
