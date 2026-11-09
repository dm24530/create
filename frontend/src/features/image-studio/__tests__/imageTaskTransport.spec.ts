import { describe, expect, it } from 'vitest'
import {
  gatewayPollUrlForTask,
  gatewayTaskPayload,
  gatewayTaskState,
  resolveGatewayPollUrl,
} from '../imageTaskTransport'

describe('image task transport', () => {
  it('unwraps a task nested in a data envelope', () => {
    expect(gatewayTaskPayload({
      data: {
        task_id: 'task-1',
        status: 'processing',
      },
    })).toEqual({
      task_id: 'task-1',
      status: 'processing',
    })
  })

  it('does not unwrap a task that already has its own identity', () => {
    const payload = {
      id: 'task-1',
      data: { status: 'processing' },
    }
    expect(gatewayTaskPayload(payload)).toBe(payload)
  })

  it('prefers the server-provided poll URL', () => {
    expect(gatewayPollUrlForTask({
      task_id: 'task-1',
      poll_url: '/v1/images/tasks/task-1',
    }, 'https://api.example.com/v1')).toBe('/v1/images/tasks/task-1')
  })

  it('builds a poll URL from the task identity', () => {
    expect(gatewayPollUrlForTask({
      task_id: 'task/one',
    }, 'https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/images/tasks/task%2Fone',
    )
  })

  it('resolves relative poll URLs against the API origin', () => {
    expect(resolveGatewayPollUrl(
      '/images/tasks/task-1',
      '/v1',
      'https://app.example.com',
    )).toBe('https://app.example.com/images/tasks/task-1')
  })

  it('classifies every server lifecycle status once', () => {
    expect(gatewayTaskState({ status: 'processing' })).toBe('pending')
    expect(gatewayTaskState({ status: 'preview_ready' })).toBe('preview_ready')
    expect(gatewayTaskState({ status: 'ready' })).toBe('completed')
    expect(gatewayTaskState({ status: 'completed' })).toBe('completed')
    expect(gatewayTaskState({ status: 'failed' })).toBe('failed')
  })
})
