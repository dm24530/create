export interface UsageStatusRow {
  record_kind?: string | null
  error_status_code?: number | null
  error_message?: string | null
  refund_status?: string | null
  refund_amount?: number | null
}

export function isFailedUsage(row: UsageStatusRow | null | undefined): boolean {
  return row?.record_kind === 'error' || row?.error_status_code != null
}

export function usageStatusLabel(row: UsageStatusRow | null | undefined): 'failed' | 'succeeded' {
  return isFailedUsage(row) ? 'failed' : 'succeeded'
}

export function errorStatusCodeLabel(row: UsageStatusRow | null | undefined): string {
  return row?.error_status_code != null ? `HTTP ${row.error_status_code}` : ''
}

export function usageErrorDetail(row: UsageStatusRow | null | undefined): string {
  const message = String(row?.error_message || '').trim()
  if (message) return message
  const status = Number(row?.error_status_code || 0)
  if (status === 400) return '请求参数无效，请检查模型、尺寸或请求格式'
  if (status === 401) return '认证失败，请重新登录或更换 API Key'
  if (status === 403) return '没有访问权限，请检查 API Key 的分组和模型权限'
  if (status === 404) return '请求的接口不存在或未启用，请检查模型与接口路径'
  if (status === 429) return '请求过于频繁或额度不足，请稍后重试'
  if (status >= 500) return '上游服务异常，请稍后重试或切换模型'
  return '请求失败，可查看操作日志获取更多信息'
}

export function isRefundedUsage(row: UsageStatusRow | null | undefined): boolean {
  const status = String(row?.refund_status || '').trim().toLowerCase()
  return status !== '' && status !== 'none'
}
