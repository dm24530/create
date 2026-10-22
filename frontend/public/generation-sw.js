const DB_NAME = 'sub2api-image-generation'
const DB_VERSION = 1
const STORE_NAME = 'tasks'

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

async function notifyClients(task) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'image-generation-task-updated', taskId: task.id, status: task.status })
  }
}

async function runTask(task) {
  const baseRecord = {
    id: task.id,
    status: 'processing',
    createdAt: task.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
  await putTask(baseRecord)
  await notifyClients(baseRecord)

  try {
    const response = await fetch(task.url, {
      method: task.init.method || 'POST',
      headers: task.init.headers,
      body: task.init.body,
      cache: 'no-store',
    })
    const body = await response.text()
    const completedRecord = {
      ...baseRecord,
      status: 'completed',
      updatedAt: Date.now(),
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body,
      },
    }
    await putTask(completedRecord)
    await notifyClients(completedRecord)
  } catch (error) {
    const failedRecord = {
      ...baseRecord,
      status: 'failed',
      updatedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error || 'Image generation failed'),
    }
    await putTask(failedRecord)
    await notifyClients(failedRecord)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'start-image-generations' || !Array.isArray(data.tasks)) return
  event.waitUntil(Promise.all(data.tasks.map((task) => runTask(task))))
})
