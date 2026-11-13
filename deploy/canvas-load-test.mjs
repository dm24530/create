import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const baseURL = process.env.CANVAS_BASE_URL || 'http://127.0.0.1:9896'
const email = process.env.CANVAS_ADMIN_EMAIL
const password = process.env.CANVAS_ADMIN_PASSWORD
const concurrency = Math.max(1, Number(process.env.CANVAS_CONCURRENCY || 50))
const nodeCount = Math.max(1, Number(process.env.CANVAS_NODES || 100))
const sameProjectConcurrency = Math.max(
  1,
  Number(process.env.CANVAS_SAME_PROJECT_CONCURRENCY || 20),
)
const cleanup = process.env.CANVAS_CLEANUP !== '0'

if (!email || !password) {
  throw new Error('CANVAS_ADMIN_EMAIL and CANVAS_ADMIN_PASSWORD are required')
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
    error.status = response.status
    throw error
  }
  return payload?.data ?? payload
}

function canvasGraph(runID, index, count) {
  const nodes = Array.from({ length: count }, (_, nodeIndex) => ({
    id: `${runID}-${index}-n${nodeIndex}`,
    type: 'text',
    title: `node-${nodeIndex}`,
    position: { x: nodeIndex * 24, y: nodeIndex * 18 },
    width: 320,
    height: 180,
    metadata: {
      content: `load test node ${nodeIndex}`,
      prompt: `load test prompt ${nodeIndex}`,
    },
  }))
  return {
    nodes,
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: 'lines',
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

async function pool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function summarize(name, results, elapsedMs) {
  const latencies = results
    .filter((result) => result.ok)
    .map((result) => result.ms)
    .sort((left, right) => left - right)
  const errors = results.filter((result) => !result.ok)
  return {
    name,
    requests: results.length,
    succeeded: latencies.length,
    failed: errors.length,
    error_statuses: errors.reduce((counts, result) => {
      const key = String(result.status || 'network')
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {}),
    elapsed_ms: Math.round(elapsedMs),
    requests_per_second: Number((results.length / (elapsedMs / 1000)).toFixed(2)),
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    p99_ms: percentile(latencies, 99),
    max_ms: latencies.at(-1) || 0,
  }
}

async function timed(operation) {
  const startedAt = performance.now()
  try {
    await operation()
    return { ok: true, ms: Math.round(performance.now() - startedAt) }
  } catch (error) {
    return {
      ok: false,
      status: error?.status,
      error: String(error?.message || error),
      ms: Math.round(performance.now() - startedAt),
    }
  }
}

const login = await jsonRequest('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
})
const token = login.access_token
if (!token) throw new Error('login did not return access_token')
const authHeaders = { Authorization: `Bearer ${token}` }

const runID = `load_${Date.now()}_${randomUUID().slice(0, 8)}`
const projectIDs = Array.from({ length: concurrency }, (_, index) => `${runID}_${index}`)

console.log(JSON.stringify({
  baseURL,
  concurrency,
  nodeCount,
  sameProjectConcurrency,
  projects: projectIDs.length,
}, null, 2))

await pool(projectIDs, Math.min(concurrency, 16), async (projectID, index) => {
  const graph = canvasGraph(runID, index, nodeCount)
  await jsonRequest(`/api/v1/canvas/projects/${projectID}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ title: `load-${index}`, graph, version: 0 }),
  })
})

const distinctStartedAt = performance.now()
const distinctResults = await pool(projectIDs, concurrency, async (projectID, index) => {
  const graph = canvasGraph(runID, index, nodeCount)
  graph.nodes[0].metadata.content = 'updated under load'
  return timed(() => jsonRequest(`/api/v1/canvas/projects/${projectID}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ title: `load-${index}-updated`, graph, version: 1 }),
  }))
})
const distinctElapsed = performance.now() - distinctStartedAt
console.log(JSON.stringify(summarize('distinct-project-saves', distinctResults, distinctElapsed), null, 2))

const sameProjectID = projectIDs[0]
const initialGraph = canvasGraph(runID, 0, nodeCount)
const baseNodeIDs = initialGraph.nodes.map((node) => node.id)
const sameStartedAt = performance.now()
const sameResults = await pool(
  Array.from({ length: sameProjectConcurrency }, (_, index) => index),
  sameProjectConcurrency,
  async (index) => timed(() => {
    const graph = canvasGraph(runID, 0, nodeCount)
    graph.nodes.push({
      id: `${runID}-shared-extra-${index}`,
      type: 'text',
      title: `extra-${index}`,
      position: { x: index * 10, y: index * 10 },
      width: 320,
      height: 180,
      metadata: { content: `concurrent merge ${index}` },
    })
    return jsonRequest(`/api/v1/canvas/projects/${sameProjectID}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        title: `shared-${index}`,
        graph,
        version: 2,
        base_node_ids: baseNodeIDs,
        base_connection_ids: [],
      }),
    })
  }),
)
const sameElapsed = performance.now() - sameStartedAt
console.log(JSON.stringify(summarize('same-project-concurrent-merge', sameResults, sameElapsed), null, 2))

const finalProject = await jsonRequest(`/api/v1/canvas/projects/${sameProjectID}`, {
  headers: authHeaders,
})
console.log(JSON.stringify({
  same_project_final_version: finalProject.version,
  same_project_final_nodes: finalProject.graph?.nodes?.length ?? 0,
}, null, 2))

if (cleanup) {
  await pool(projectIDs, 8, async (projectID) => {
    await jsonRequest(`/api/v1/canvas/projects/${projectID}`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => undefined)
  })
}
