export interface ImageStudioErrorOptions {
  fallback: string
  isAdmin: boolean
}

export function formatImageStudioErrorMessage(
  error: unknown,
  options: ImageStudioErrorOptions,
) {
  const reason = nestedErrorField(error, 'reason')
  if (reason === 'IMAGE_STORAGE_DISABLED' || reason === 'IMAGE_STORAGE_INCOMPLETE') {
    if (!options.isAdmin) return ''
    return reason === 'IMAGE_STORAGE_DISABLED'
      ? '图片存储未启用：请到后台「设置 → 数据备份」打开「异步生图对象存储」。'
      : '图片存储凭证不完整：请到后台「设置 → 数据备份」补齐存储桶与密钥。'
  }
  const message = nestedErrorMessage(error)
  const status = nestedErrorStatus(error)
  const normalized = message.trim().toLowerCase()
  if (!normalized) return status ? `请求失败 (HTTP ${status})` : options.fallback
  if (
    normalized === 'failed to fetch'
    || normalized.includes('networkerror')
    || normalized.includes('network error')
  ) {
    return '无法连接到 API 服务，请检查网络或 API 地址。'
  }
  if (
    normalized.includes('insufficient account balance')
    || normalized.includes('insufficient_balance')
    || normalized.includes('insufficient balance')
    || normalized.includes('余额不足')
  ) {
    return '账户余额不足，请先充值或换一个有余额的 API Key。'
  }
  if (
    normalized.includes('service temporarily unavailable')
    || normalized.includes('upstream service temporarily unavailable')
  ) {
    return '当前模型暂时不可用，请稍后重试或换一个模型。'
  }
  if (
    normalized.includes('api key is required')
    || normalized.includes('authorization header')
  ) {
    return '当前 API Key 未正确传给服务，请刷新页面或重新选择可用密钥。'
  }
  const finalMessage = message || options.fallback
  return status && !/HTTP\s+\d+/i.test(finalMessage)
    ? `请求失败 (HTTP ${status})：${finalMessage}`
    : finalMessage
}

export function nestedErrorMessage(error: unknown, depth = 0): string {
  if (depth > 4 || error == null) return ''
  if (typeof error === 'string') {
    const trimmed = error.trim()
    if (!trimmed) return ''
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
      || (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return nestedErrorMessage(JSON.parse(trimmed), depth + 1) || trimmed
      } catch {
        return trimmed
      }
    }
    return trimmed
  }
  if (typeof error !== 'object') return ''

  const record = error as Record<string, unknown>
  const response = isPlainRecord(record.response) ? record.response : null
  const responseMessage = nestedErrorMessage(response?.data, depth + 1)
  if (responseMessage) return responseMessage
  for (const key of ['message', 'msg', 'detail', 'reason']) {
    const value = nestedErrorMessage(record[key], depth + 1)
    if (value) return value
  }
  const nestedError = nestedErrorMessage(record.error, depth + 1)
  if (nestedError) return nestedError
  return error instanceof Error ? error.message.trim() : ''
}

export function nestedErrorStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 3 || !isPlainRecord(error)) return undefined
  for (const key of ['status', 'statusCode', 'http_status']) {
    const status = Number(error[key])
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status
  }
  return nestedErrorStatus(error.response, depth + 1)
    || nestedErrorStatus(error.error, depth + 1)
}

export function nestedErrorField(
  error: unknown,
  field: string,
  depth = 0,
): string {
  if (depth > 3 || !isPlainRecord(error)) return ''
  const value = error[field]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (isPlainRecord(value)) {
    const nested = nestedErrorField(value, field, depth + 1)
    if (nested) return nested
  }
  const response = isPlainRecord(error.response) ? error.response : null
  return nestedErrorField(response?.data, field, depth + 1)
    || nestedErrorField(response, field, depth + 1)
    || nestedErrorField(error.error, field, depth + 1)
}

export function isImageStorageConfigError(error: unknown): boolean {
  const reason = nestedErrorField(error, 'reason')
  return reason === 'IMAGE_STORAGE_DISABLED' || reason === 'IMAGE_STORAGE_INCOMPLETE'
}

export function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
