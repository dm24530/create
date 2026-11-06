export interface ImageGenerationWorkerRequest {
  id: string
  url: string
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string | FormData
  }
  createdAt?: number
}

export interface ImageGenerationWorkerResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
  startedAt?: number
  completedAt?: number
}

export type ImageGenerationStoredBody =
  | { kind: 'text'; text: string }
  | { kind: 'form'; entries: Array<{ name: string; value: string | Blob }> }

export interface PersistedImageGenerationRequest {
  id: string
  url: string
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: ImageGenerationStoredBody
  }
  createdAt: number
}

interface StoredImageGenerationResponse {
  ok: boolean
  status: number
  statusText: string
  body?: string
  cacheKey?: string
}

interface ImageGenerationTaskRecord {
  id: string
  status: 'queued' | 'processing' | 'ready' | 'completed' | 'failed'
  createdAt: number
  updatedAt: number
  attempts?: number
  deadlineAt?: number
  request?: PersistedImageGenerationRequest
  response?: StoredImageGenerationResponse
  error?: string
}

const DB_NAME = 'sub2api-image-generation'
const DB_VERSION = 1
const STORE_NAME = 'tasks'
const RESPONSE_CACHE = 'sub2api-image-generation-responses-v1'
const WORKER_URL = '/generation-sw.js'
const WAIT_INTERVAL_MS = 750
const WAIT_TIMEOUT_MS = 3 * 60 * 1000
const TASK_DEADLINE_MS = 3 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 15 * 1000

export class ImageGenerationWaitCancelled extends Error {
  constructor() {
    super('Image generation wait cancelled')
    this.name = 'ImageGenerationWaitCancelled'
  }
}

export class ImageGenerationStillRunning extends Error {
  constructor(message = '图片生成超过 3 分钟，已停止等待') {
    super(message)
    this.name = 'ImageGenerationStillRunning'
  }
}

let heartbeatTimer: number | null = null
let heartbeatDeadline = 0
let heartbeatTaskIds = new Set<string>()

function canUsePersistentGeneration() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof indexedDB !== 'undefined'
}

function openTaskDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open image task database'))
  })
}

async function putTaskRecords(records: ImageGenerationTaskRecord[]) {
  if (!records.length) return
  const db = await openTaskDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    for (const record of records) store.put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Failed to store image tasks'))
  })
  db.close()
}

async function getTaskRecord(id: string): Promise<ImageGenerationTaskRecord | null> {
  const db = await openTaskDb()
  const record = await new Promise<ImageGenerationTaskRecord | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve((request.result as ImageGenerationTaskRecord | undefined) || null)
    request.onerror = () => reject(request.error || new Error('Failed to read image task'))
  })
  db.close()
  return record
}

async function deleteTaskRecords(ids: string[]) {
  if (!ids.length) return
  const db = await openTaskDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    for (const id of ids) store.delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Failed to clear image tasks'))
  })
  db.close()
  if ('caches' in window) {
    const cache = await caches.open(RESPONSE_CACHE)
    await Promise.all(ids.map((id) => cache.delete(
      new Request(`/__image-generation-responses__/${encodeURIComponent(id)}`),
    )))
  }
}

async function waitForWorker(): Promise<ServiceWorker> {
  const registration = await navigator.serviceWorker.register(WORKER_URL, {
    updateViaCache: 'none',
  })
  await registration.update().catch(() => undefined)
  await navigator.serviceWorker.ready
  const worker = registration.active || navigator.serviceWorker.controller
  if (!worker) throw new Error('Image generation worker is not active')
  return worker
}

async function postResumeMessage(ids: string[]) {
  const registration = await navigator.serviceWorker.ready
  const worker = registration.active || navigator.serviceWorker.controller
  if (!worker || !ids.length) return
  worker.postMessage({ type: 'resume-image-generations', taskIds: ids })
}

function stopGenerationHeartbeat() {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  heartbeatTaskIds = new Set()
  heartbeatDeadline = 0
}

async function heartbeatTick() {
  if (Date.now() > heartbeatDeadline || heartbeatTaskIds.size === 0) {
    stopGenerationHeartbeat()
    return
  }
  const ids = Array.from(heartbeatTaskIds)
  const records = await Promise.all(ids.map((id) => getTaskRecord(id).catch(() => null)))
  const activeIds = ids.filter((_, index) => {
    const status = records[index]?.status
    return status === 'queued' || status === 'processing'
  })
  heartbeatTaskIds = new Set(activeIds)
  if (!activeIds.length) {
    stopGenerationHeartbeat()
    return
  }
  await postResumeMessage(activeIds).catch(() => undefined)
}

export function keepPersistentImageGenerationAlive(ids: string[]) {
  if (typeof window === 'undefined' || !canUsePersistentGeneration()) return
  for (const id of ids) {
    if (id) heartbeatTaskIds.add(id)
  }
  heartbeatDeadline = Math.max(heartbeatDeadline, Date.now() + TASK_DEADLINE_MS)
  if (heartbeatTimer !== null) return
  heartbeatTimer = window.setInterval(() => {
    void heartbeatTick()
  }, HEARTBEAT_INTERVAL_MS)
}

async function taskRecordToResponse(
  record: ImageGenerationTaskRecord,
): Promise<ImageGenerationWorkerResponse> {
  if (record.status === 'failed') {
    return {
      ok: false,
      status: 0,
      statusText: 'Worker request failed',
      body: record.error || '图片生成任务失败',
      startedAt: record.request?.createdAt,
      completedAt: record.updatedAt,
    }
  }
  if (!record.response) {
    return {
      ok: false,
      status: 0,
      statusText: 'Missing response',
      body: '图片生成任务没有返回结果',
      startedAt: record.request?.createdAt,
      completedAt: record.updatedAt,
    }
  }
  if (record.response.body != null) {
    return {
      ok: record.response.ok,
      status: record.response.status,
      statusText: record.response.statusText,
      body: record.response.body,
      startedAt: record.request?.createdAt,
      completedAt: record.updatedAt,
    }
  }
  if (!('caches' in window)) {
    throw new Error('浏览器不支持读取后台生成结果')
  }
  const cache = await caches.open(RESPONSE_CACHE)
  const cached = await cache.match(
    new Request(`/__image-generation-responses__/${encodeURIComponent(record.id)}`),
  )
  if (!cached) {
    throw new Error('后台生成结果已丢失，请重新生成')
  }
  return {
    ok: record.response.ok,
    status: record.response.status,
    statusText: record.response.statusText,
    body: await cached.text(),
    startedAt: record.request?.createdAt,
    completedAt: record.updatedAt,
  }
}

export function createImageGenerationTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `imgtask_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function serializeImageGenerationBody(body: string | FormData): ImageGenerationStoredBody {
  if (typeof body === 'string') {
    return { kind: 'text', text: body }
  }
  const entries: Array<{ name: string; value: string | Blob }> = []
  body.forEach((value, name) => {
    entries.push({ name, value })
  })
  return { kind: 'form', entries }
}

export function persistableImageGenerationRequest(
  request: ImageGenerationWorkerRequest,
): PersistedImageGenerationRequest {
  return {
    id: request.id,
    url: request.url,
    init: {
      method: 'POST',
      headers: { ...request.init.headers },
      body: serializeImageGenerationBody(request.init.body),
    },
    createdAt: request.createdAt || Date.now(),
  }
}

export async function tryStartPersistentImageGeneration(
  requests: ImageGenerationWorkerRequest[],
): Promise<boolean> {
  if (!canUsePersistentGeneration() || requests.length === 0) return false
  try {
    const worker = await waitForWorker()
    const now = Date.now()
    await putTaskRecords(requests.map((request) => {
      const persisted = persistableImageGenerationRequest(request)
      return {
        id: persisted.id,
        status: 'queued',
        createdAt: persisted.createdAt,
        updatedAt: now,
        attempts: 0,
        deadlineAt: Math.min(
          now + TASK_DEADLINE_MS,
          persisted.createdAt + TASK_DEADLINE_MS,
        ),
        request: persisted,
      }
    }))
    worker.postMessage({
      type: 'start-image-generations',
      taskIds: requests.map((request) => request.id),
      // Older active workers only understand raw tasks. New workers use the
      // persisted IndexedDB records and ignore this compatibility payload.
      tasks: requests,
    })
    keepPersistentImageGenerationAlive(requests.map((request) => request.id))
    return true
  } catch {
    return false
  }
}

export async function waitForPersistentImageGeneration(
  ids: string[],
  options: {
    isCancelled?: () => boolean
    heartbeatMs?: number
    onResponse?: (id: string, response: ImageGenerationWorkerResponse) => void | Promise<void>
  } = {},
): Promise<ImageGenerationWorkerResponse[]> {
  if (!canUsePersistentGeneration() || ids.length === 0) {
    throw new Error('Persistent image generation is unavailable')
  }
  keepPersistentImageGenerationAlive(ids)
  try {
    const worker = await waitForWorker()
    worker.postMessage({ type: 'resume-image-generations', taskIds: ids })
  } catch {
    // Polling can still recover tasks that already completed in IndexedDB.
  }
  const startedAt = Date.now()
  const responses = new Map<string, ImageGenerationWorkerResponse>()
  let lastHeartbeatAt = Date.now()
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS

  while (responses.size < ids.length) {
    if (options.isCancelled?.()) {
      throw new ImageGenerationWaitCancelled()
    }
    if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
      lastHeartbeatAt = Date.now()
      await postResumeMessage(ids).catch(() => undefined)
    }
    for (const id of ids) {
      if (responses.has(id)) continue
      const record = await getTaskRecord(id)
      if (record?.status === 'ready' || record?.status === 'completed' || record?.status === 'failed') {
        const response = await taskRecordToResponse(record)
        responses.set(id, response)
        await options.onResponse?.(id, response)
      }
    }
    if (responses.size === ids.length) break
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new ImageGenerationStillRunning()
    }
    await new Promise((resolve) => window.setTimeout(resolve, WAIT_INTERVAL_MS))
  }

  await deleteTaskRecords(ids)
  return ids.map((id) => responses.get(id)!)
}
