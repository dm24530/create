const DB_NAME = 'sub2api-image-generation'
const DB_VERSION = 1
const STORE_NAME = 'tasks'
const RESPONSE_CACHE = 'sub2api-image-generation-responses-v1'
const TASK_TIMEOUT_MS = 5 * 60 * 1000
const RETRY_WINDOW_MS = 5 * 60 * 1000
const MIN_RETRY_DELAY_MS = 1500
const MAX_RETRY_DELAY_MS = 30 * 1000

const runningTasks = new Set()

function openTaskDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open task database'))
  })
}

async function putTask(task) {
  const db = await openTaskDb()
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(task)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error || new Error('Failed to store task'))
  })
  db.close()
}

async function getTask(id) {
  const db = await openTaskDb()
  const task = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('Failed to read task'))
  })
  db.close()
  return task
}

async function getAllTasks() {
  const db = await openTaskDb()
  const tasks = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error || new Error('Failed to read tasks'))
  })
  db.close()
  return tasks
}

async function notifyClients(task) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({
      type: 'image-generation-task-updated',
      taskId: task.id,
      status: task.status,
      attempts: task.attempts || 0,
    })
  }
}

function responseCacheRequest(id) {
  return new Request(`/__image-generation-responses__/${encodeURIComponent(id)}`)
}

function bodyFromRecord(body) {
  if (body?.kind === 'text') return body.text || ''
  const form = new FormData()
  for (const entry of body?.entries || []) {
    if (entry && typeof entry.name === 'string') {
      form.append(entry.name, entry.value)
    }
  }
  return form
}

function isRetryableStatus(status) {
  // Only retry statuses that indicate the request was rejected before
  // generation. Timeouts and 5xx responses are ambiguous for a POST and may
  // already have been accepted and billed upstream.
  return status === 425 || status === 429
}

function retryDelay(attempt, response) {
  const retryAfter = Number(response?.headers?.get?.('retry-after') || 0)
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, retryAfter * 1000))
  }
  return Math.min(MAX_RETRY_DELAY_MS, MIN_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)))
}

function errorMessageFromResponse(body, status, statusText) {
  try {
    const payload = JSON.parse(body)
    return String(
      payload?.error?.message
      || payload?.message
      || payload?.error
      || `${status} ${statusText}`,
    )
  } catch {
    return String(body || `${status} ${statusText}` || '图片生成请求失败').slice(0, 1000)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTask(taskId) {
  if (!taskId || runningTasks.has(taskId)) return
  runningTasks.add(taskId)

  try {
    const initial = await getTask(taskId)
    if (!initial) return
    if (initial.status === 'completed') return
    if (!initial.request?.url || !initial.request?.init) {
      const failedRecord = {
        ...initial,
        status: 'failed',
        updatedAt: Date.now(),
        error: '生成请求缓存缺失，请重新生成。',
      }
      await putTask(failedRecord)
      await notifyClients(failedRecord)
      return
    }

    let task = initial
    let attempts = Number(task.attempts || 0)
    const deadlineAt = Number(task.deadlineAt || 0) || Date.now() + RETRY_WINDOW_MS

    while (Date.now() < deadlineAt) {
      attempts += 1
      const processingRecord = {
        ...task,
        status: 'processing',
        attempts,
        deadlineAt,
        nextRetryAt: 0,
        updatedAt: Date.now(),
      }
      await putTask(processingRecord)
      await notifyClients(processingRecord)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort('image generation timeout'), TASK_TIMEOUT_MS)
      let response = null
      let responseBody = ''
      let requestError = null

      try {
        response = await fetch(task.request.url, {
          method: task.request.init.method || 'POST',
          headers: task.request.init.headers,
          body: bodyFromRecord(task.request.init.body),
          cache: 'no-store',
          signal: controller.signal,
        })
        responseBody = await response.text()
      } catch (error) {
        requestError = error
      } finally {
        clearTimeout(timeout)
      }

      // A missing response may mean the upstream already accepted the request.
      // Retrying it without an idempotency key can generate and bill twice.
      const retryable = response != null && isRetryableStatus(response.status)
      if (!retryable) {
        if (!response) {
          const failedRecord = {
            ...processingRecord,
            status: 'failed',
            updatedAt: Date.now(),
            error: requestError instanceof Error
              ? requestError.message
              : '图片生成请求中断；为避免重复扣费，未自动重试',
          }
          await putTask(failedRecord)
          await notifyClients(failedRecord)
          return
        }
        const failureMessage = response.ok ? '' : errorMessageFromResponse(
          responseBody,
          response.status,
          response.statusText,
        )
        const completedRecord = {
          ...processingRecord,
          status: response.ok ? 'completed' : 'failed',
          updatedAt: Date.now(),
          response: response.ok
            ? {
                ok: true,
                status: response.status,
                statusText: response.statusText,
                cacheKey: task.id,
              }
            : undefined,
          error: response.ok ? undefined : failureMessage,
        }
        if (response.ok) {
          const cache = await caches.open(RESPONSE_CACHE)
          await cache.put(
            responseCacheRequest(task.id),
            new Response(responseBody, {
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        await putTask(completedRecord)
        await notifyClients(completedRecord)
        return
      }

      const delay = retryDelay(
        attempts,
        response?.ok === false ? response : null,
      )
      if (Date.now() + delay >= deadlineAt) break

      const retryRecord = {
        ...processingRecord,
        status: 'queued',
        nextRetryAt: Date.now() + delay,
        updatedAt: Date.now(),
        error: requestError instanceof Error
          ? requestError.message
          : response
            ? errorMessageFromResponse(responseBody, response.status, response.statusText)
            : '网络连接中断',
      }
      await putTask(retryRecord)
      await notifyClients(retryRecord)
      task = retryRecord
      await sleep(delay)
    }

    const failedRecord = {
      ...task,
      status: 'failed',
      updatedAt: Date.now(),
      error: '网络持续不可用，图片生成已暂停。网络恢复后可重新发起生成。',
    }
    await putTask(failedRecord)
    await notifyClients(failedRecord)
  } catch (error) {
    const current = await getTask(taskId).catch(() => null)
    const failedRecord = {
      ...(current || {
        id: taskId,
        status: 'failed',
        createdAt: Date.now(),
      }),
      status: 'failed',
      updatedAt: Date.now(),
      error: error && error.name === 'AbortError'
        ? '图片生成超时，请重试或降低质量/数量'
        : error instanceof Error
          ? error.message
          : String(error || '图片生成任务失败'),
    }
    await putTask(failedRecord).catch(() => undefined)
    await notifyClients(failedRecord).catch(() => undefined)
  } finally {
    runningTasks.delete(taskId)
  }
}

async function recoverTasks(taskIds = null) {
  const tasks = Array.isArray(taskIds) && taskIds.length
    ? await Promise.all(taskIds.map((id) => getTask(id)))
    : await getAllTasks()
  const resumable = []
  for (const task of tasks) {
    if (!task || runningTasks.has(task.id)) continue
    if (task.status === 'processing') {
      // The request may already have reached the server. Re-sending it after a
      // browser/worker suspension can generate and bill twice, so fail closed.
      const failedRecord = {
        ...task,
        status: 'failed',
        updatedAt: Date.now(),
        error: '浏览器后台生成被中断，结果无法确认；为避免重复扣费未自动重试。请先查看我的作品，确认没有结果后再重新生成。',
      }
      await putTask(failedRecord)
      await notifyClients(failedRecord)
      continue
    }
    if (task.status === 'queued' && task.request) {
      resumable.push(task)
    }
  }
  await Promise.allSettled(resumable.map((task) => runTask(task.id)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    await recoverTasks()
  })())
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data) return
  if (data.type !== 'start-image-generations' && data.type !== 'resume-image-generations') {
    return
  }
  const taskIds = Array.isArray(data.taskIds)
    ? data.taskIds.filter((id) => typeof id === 'string' && id)
    : []
  event.waitUntil(recoverTasks(taskIds))
})
