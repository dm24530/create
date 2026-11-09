const DB_NAME = 'sub2api-image-generation'
const DB_VERSION = 1
const STORE_NAME = 'tasks'
const RESPONSE_CACHE = 'sub2api-image-generation-responses-v1'
const TASK_TIMEOUT_MS = 10 * 60 * 1000
const TASK_DEADLINE_MS = 10 * 60 * 1000

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

    const deadlineAt = Number(initial.deadlineAt || 0) || Date.now() + TASK_DEADLINE_MS
    if (Date.now() >= deadlineAt) {
      const failedRecord = {
        ...initial,
        status: 'failed',
        updatedAt: Date.now(),
        error: '图片生成超过 10 分钟，已停止等待，请重新生成',
      }
      await putTask(failedRecord)
      await notifyClients(failedRecord)
      return
    }

    const attempts = Number(initial.attempts || 0) + 1
    const processingRecord = {
      ...initial,
      status: 'processing',
      attempts,
      deadlineAt,
      updatedAt: Date.now(),
    }
    await putTask(processingRecord)
    await notifyClients(processingRecord)

    const controller = new AbortController()
    const remainingMs = Math.max(1, deadlineAt - Date.now())
    const timeout = setTimeout(
      () => controller.abort('image generation timeout'),
      Math.min(TASK_TIMEOUT_MS, remainingMs),
    )
    let response = null
    let responseBody = ''
    let requestError = null

    try {
      response = await fetch(processingRecord.request.url, {
        method: processingRecord.request.init.method || 'POST',
        headers: processingRecord.request.init.headers,
        body: bodyFromRecord(processingRecord.request.init.body),
        cache: 'no-store',
        signal: controller.signal,
      })
      responseBody = await response.text()
    } catch (error) {
      requestError = error
    } finally {
      clearTimeout(timeout)
    }

    if (!response) {
      const failedRecord = {
        ...processingRecord,
        status: 'failed',
        updatedAt: Date.now(),
        error: requestError?.name === 'AbortError'
          ? '图片生成超过 10 分钟，已停止等待，请重新生成'
          : requestError instanceof Error
            ? requestError.message
            : '图片生成请求中断',
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
            cacheKey: processingRecord.id,
          }
        : undefined,
      error: response.ok ? undefined : failureMessage,
    }
    if (response.ok) {
      const cache = await caches.open(RESPONSE_CACHE)
      await cache.put(
        responseCacheRequest(processingRecord.id),
        new Response(responseBody, {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    await putTask(completedRecord)
    await notifyClients(completedRecord)
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
