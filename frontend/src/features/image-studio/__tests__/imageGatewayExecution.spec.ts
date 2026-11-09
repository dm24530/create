import { describe, expect, it } from 'vitest'
import {
  buildGatewayAsyncRequestBody,
  withIdempotencyHeader,
} from '../imageGatewayExecution'

describe('image gateway execution', () => {
  it('wraps Gemini image requests with their model and parsed payload', () => {
    expect(buildGatewayAsyncRequestBody(
      JSON.stringify({ prompt: 'a cat' }),
      'gemini-image',
      true,
    )).toBe(JSON.stringify({
      model: 'gemini-image',
      request: { prompt: 'a cat' },
    }))
  })

  it('leaves non-Gemini request bodies unchanged', () => {
    const body = new FormData()
    body.append('prompt', 'a cat')
    expect(buildGatewayAsyncRequestBody(body, 'gpt-image-1', false)).toBe(body)
  })

  it('adds an idempotency header without mutating the original headers', () => {
    const headers = { Authorization: 'Bearer test' }
    expect(withIdempotencyHeader(headers, 'task-1')).toEqual({
      Authorization: 'Bearer test',
      'Idempotency-Key': 'task-1',
    })
    expect(headers).toEqual({ Authorization: 'Bearer test' })
  })
})
