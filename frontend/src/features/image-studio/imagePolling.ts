const MIN_POLL_DELAY_MS = 250

/**
 * Image generation already takes tens of seconds upstream. A sparse first poll
 * only adds dead time after the task is ready, so use the steady local polling
 * cadence from the beginning.
 */
export function imageTaskPollInterval(_elapsedMs: number): number {
  return MIN_POLL_DELAY_MS
}

/**
 * Transient failures should retry promptly without creating a tight loop.
 */
export function imageTaskRetryDelay(_elapsedMs: number): number {
  return 500
}

/**
 * Once a preview is visible, the user is waiting only for the durable original
 * to replace it. Poll quickly so that transition does not add another long wait.
 */
export function imageTaskNextPollDelay(elapsedMs: number, previewReady: boolean): number {
  return previewReady ? MIN_POLL_DELAY_MS : imageTaskPollInterval(elapsedMs)
}
