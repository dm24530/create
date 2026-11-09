import { describe, expect, it } from 'vitest'
import {
  formatImageStudioErrorMessage,
  isImageStorageConfigError,
  nestedErrorMessage,
  nestedErrorStatus,
} from '../imageStudioErrors'

describe('image studio errors', () => {
  it('extracts nested response messages and status codes', () => {
    const error = {
      response: {
        status: 503,
        data: {
          error: {
            message: 'upstream unavailable',
          },
        },
      },
    }
    expect(nestedErrorMessage(error)).toBe('upstream unavailable')
    expect(nestedErrorStatus(error)).toBe(503)
  })

  it('translates network failures', () => {
    expect(formatImageStudioErrorMessage(new Error('failed to fetch'), {
      fallback: 'fallback',
      isAdmin: false,
    })).toBe('无法连接到 API 服务，请检查网络或 API 地址。')
  })

  it('translates insufficient balance failures', () => {
    expect(formatImageStudioErrorMessage(new Error('insufficient account balance'), {
      fallback: 'fallback',
      isAdmin: false,
    })).toBe('账户余额不足，请先充值或换一个有余额的 API Key。')
  })

  it('hides storage configuration details from non-admin users', () => {
    const error = {
      response: {
        data: {
          reason: 'IMAGE_STORAGE_DISABLED',
        },
      },
    }
    expect(isImageStorageConfigError(error)).toBe(true)
    expect(formatImageStudioErrorMessage(error, {
      fallback: 'fallback',
      isAdmin: false,
    })).toBe('')
  })

  it('shows actionable storage configuration details to admins', () => {
    expect(formatImageStudioErrorMessage({
      reason: 'IMAGE_STORAGE_INCOMPLETE',
    }, {
      fallback: 'fallback',
      isAdmin: true,
    })).toContain('补齐存储桶与密钥')
  })

  it('includes an HTTP status when the message has none', () => {
    expect(formatImageStudioErrorMessage({
      response: {
        status: 502,
        data: {
          message: 'bad gateway',
        },
      },
    }, {
      fallback: 'fallback',
      isAdmin: false,
    })).toBe('请求失败 (HTTP 502)：bad gateway')
  })
})
