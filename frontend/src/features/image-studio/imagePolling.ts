const MIN_POLL_DELAY_MS = 750

/**
 * Image generation is usually slow at the start and finishes later. Poll
 * sparsely while the upstream is still starting, then increase frequency as
 * the task approaches the common completion window.
 */
export function imageTaskPollInterval(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  if (elapsed < 5_000) return 5_000
  if (elapsed < 15_000) return 2_500
  if (elapsed < 30_000) return 1_500
  if (elapsed < 60_000) return 1_000
  return MIN_POLL_DELAY_MS
}

/**
 * Transient failures need a prompt retry even during the initial low-frequency
 * window, but should never create a tight retry loop.
 */
export function imageTaskRetryDelay(elapsedMs: number): number {
  return Math.min(2_000, imageTaskPollInterval(elapsedMs))
}

/**
 * Once a preview is visible, the user is waiting only for the durable original
 * to replace it. Poll quickly so that transition does not add another long wait.
 */
export function imageTaskNextPollDelay(elapsedMs: number, previewReady: boolean): number {
  return previewReady ? MIN_POLL_DELAY_MS : imageTaskPollInterval(elapsedMs)
}
