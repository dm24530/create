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
}

interface ImageGenerationTaskRecord {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  createdAt: number
  updatedAt: number
  response?: ImageGenerationWorkerResponse
  error?: string
}

const DB_NAME = 'sub2api-image-generation'
const DB_VERSION = 1
const STORE_NAME = 'tasks'
const WORKER_URL = '/generation-sw.js'
const WAIT_INTERVAL_MS = 750
const WAIT_TIMEOUT_MS = 15 * 60 * 1000

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

async function putTaskRecord(record: ImageGenerationTaskRecord) {
  const db = await openTaskDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Failed to store image task'))
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
}

async function waitForWorker(): Promise<ServiceWorker> {
  const registration = await navigator.serviceWorker.register(WORKER_URL)
  await navigator.serviceWorker.ready
  const worker = registration.active || navigator.serviceWorker.controller
  if (!worker) throw new Error('Image generation worker is not active')
  return worker
}

function taskRecordToResponse(record: ImageGenerationTaskRecord): ImageGenerationWorkerResponse {
  if (record.status === 'failed') {
    return {
      ok: false,
      status: 0,
      statusText: 'Worker request failed',
      body: record.error || '图片生成任务失败',
    }
  }
  if (!record.response) {
    return {
      ok: false,
      status: 0,
      statusText: 'Missing response',
      body: '图片生成任务没有返回结果',
    }
  }
  return record.response
}

export function createImageGenerationTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `imgtask_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export async function tryStartPersistentImageGeneration(
  requests: ImageGenerationWorkerRequest[],
): Promise<boolean> {
  if (!canUsePersistentGeneration() || requests.length === 0) return false
  try {
    const worker = await waitForWorker()
    const now = Date.now()
    for (const request of requests) {
      await putTaskRecord({
        id: request.id,
        status: 'queued',
        createdAt: request.createdAt || now,
        updatedAt: now,
      })
    }
    worker.postMessage({ type: 'start-image-generations', tasks: requests })
    return true
  } catch {
    return false
  }
}

export async function waitForPersistentImageGeneration(
  ids: string[],
): Promise<ImageGenerationWorkerResponse[]> {
  if (!canUsePersistentGeneration() || ids.length === 0) {
    throw new Error('Persistent image generation is unavailable')
  }
  const startedAt = Date.now()
  const responses = new Map<string, ImageGenerationWorkerResponse>()

  while (responses.size < ids.length) {
    for (const id of ids) {
      if (responses.has(id)) continue
      const record = await getTaskRecord(id)
      if (record?.status === 'completed' || record?.status === 'failed') {
        responses.set(id, taskRecordToResponse(record))
      }
    }
    if (responses.size === ids.length) break
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error('图片生成超时，请稍后重试')
    }
    await new Promise((resolve) => window.setTimeout(resolve, WAIT_INTERVAL_MS))
  }

  await deleteTaskRecords(ids)
  return ids.map((id) => responses.get(id)!)
}
