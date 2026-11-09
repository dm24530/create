export type GatewayTaskState = 'pending' | 'preview_ready' | 'completed' | 'failed'

export function gatewayTaskPayload(payload: unknown): any {
  const value = payload as any
  return value?.data && !value?.task_id && !value?.id ? value.data : value
}

export function gatewayPollUrlForTask(task: unknown, apiBaseUrl: string): string {
  const value = task as any
  const direct = String(value?.poll_url || '').trim()
  if (direct) return direct
  const id = String(value?.task_id || value?.id || '').trim()
  return id
    ? `${apiBaseUrl.replace(/\/+$/, '')}/images/tasks/${encodeURIComponent(id)}`
    : ''
}

export function resolveGatewayPollUrl(
  raw: string,
  apiBaseUrl: string,
  fallbackOrigin = 'http://localhost',
): string {
  if (/^https?:\/\//i.test(raw)) return raw
  const origin = new URL(apiBaseUrl || fallbackOrigin, fallbackOrigin).origin
  return new URL(raw, origin).toString()
}

export function gatewayTaskState(task: unknown): GatewayTaskState {
  const status = String((task as any)?.status || '').trim().toLowerCase()
  if (status === 'ready' || status === 'completed') return 'completed'
  if (status === 'preview_ready') return 'preview_ready'
  if (status === 'failed') return 'failed'
  return 'pending'
}
