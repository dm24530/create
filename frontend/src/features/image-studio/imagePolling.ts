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
 * Keep polling quickly after the preview appears so the durable original
 * replaces it as soon as it is ready.
 */
export function imageTaskNextPollDelay(elapsedMs: number, previewReady: boolean): number {
  return previewReady ? MIN_POLL_DELAY_MS : imageTaskPollInterval(elapsedMs)
}
