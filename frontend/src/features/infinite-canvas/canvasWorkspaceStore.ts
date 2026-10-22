import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ViewportTransform } from '@vue-flow/core'

import { authAPI } from '@/api'
import canvasProjectAPI from '@/api/canvas'
import imageStudioGalleryAPI from '@/api/imageStudio'
import { ensureCreatorKey } from '@/composables/useCreatorKey'
import { deduplicateModels, isImageGenerationModel } from '@/features/infinite-canvas/canvasModels'
import {
  createVideoTask,
  fetchVideoPlayableUrl,
  isVideoModel,
  pollVideoTask,
  type VideoProvider,
} from '@/features/video-studio/videoStudioApi'
import { archiveVideo } from '@/features/video-studio/videoArchiveApi'
import { resolvePlaygroundApiEndpoint } from '@/utils/apiEndpoint'
import type { ApiKey } from '@/types'
import type {
  CanvasFlowEdge,
  CanvasFlowNode,
  CanvasGraph,
  CanvasGraphEdge,
  CanvasGraphNode,
  CanvasImageReference,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasProject,
} from '@/types/canvas'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const IMAGE_DEFAULT_SIZE = '1024x1024'
const VIDEO_DEFAULT_DURATION = 5
const VIDEO_DEFAULT_RESOLUTION = '720p'
const VIDEO_DEFAULT_ASPECT_RATIO = '16:9'
const AUTOSAVE_DELAY_MS = 900
const IMAGE_STUDIO_PREFERENCES_KEY = 'sub2api:image-studio:preferences'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const record = error as { message?: unknown; reason?: unknown } | null
  return String(record?.message || record?.reason || error || '操作失败')
}

function createNodeID(kind: CanvasNodeKind): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${kind}-${random}`
}

function createEdgeID(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `edge-${random}`
}

function modelIDs(payload: any): string[] {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : []
  return source
    .map((item: any) => String(item?.id || item?.name || item || '').trim())
    .filter(Boolean)
}

function extractImageResult(payload: any): { url?: string; dataURL?: string } {
  if (!payload) return {}
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const nested = extractImageResult(item)
      if (nested.url || nested.dataURL) return nested
    }
  }
  if (Array.isArray(payload.candidates)) {
    for (const candidate of payload.candidates) {
      for (const part of candidate?.content?.parts || []) {
        if (part?.inlineData?.data) {
          return {
            dataURL: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
          }
        }
      }
    }
  }
  const url = String(payload.url || payload.image_url || payload.result?.url || '').trim()
  if (url) return { url }
  const b64 = String(payload.b64_json || payload.data || '').trim()
  if (b64 && !Array.isArray(payload.data)) {
    return {
      dataURL: `data:${payload.mime_type || payload.mimeType || 'image/png'};base64,${b64}`,
    }
  }
  return {}
}

function taskPayload(payload: any): any {
  return payload?.data && !payload?.task_id && !payload?.id ? payload.data : payload
}

function taskError(payload: any): Error {
  return new Error(String(
    payload?.error?.message
    || payload?.error
    || payload?.message
    || '生成任务失败',
  ))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取生成内容失败'))
    reader.readAsDataURL(blob)
  })
}

export const useCanvasWorkspaceStore = defineStore('canvas-workspace', () => {
  const project = ref<CanvasProject | null>(null)
  const nodes = ref<CanvasFlowNode[]>([])
  const edges = ref<CanvasFlowEdge[]>([])
  const viewport = ref<ViewportTransform>({ x: 0, y: 0, zoom: 1 })
  const loading = ref(false)
  const saveState = ref<SaveState>('idle')
  const saveError = ref('')
  const generationError = ref('')
  const imageModels = ref<string[]>([])
  const videoModels = ref<string[]>([])
  const apiBaseUrl = ref('')
  const availableKeys = ref<ApiKey[]>([])
  const selectedKeyId = ref('')
  const contextReady = ref(false)

  let saveTimer: number | null = null
  let hydrating = false
  const resumedTaskIds = new Set<string>()

  const projectId = computed(() => project.value?.id || '')
  const title = computed({
    get: () => project.value?.title || '',
    set: (value: string) => {
      if (!project.value) return
      project.value.title = value
      scheduleSave()
    },
  })
  const version = computed(() => project.value?.version || 0)
  const hasModels = computed(() => imageModels.value.length > 0 || videoModels.value.length > 0)
  const creatorKey = computed(() => (
    availableKeys.value.find((key) => String(key.id) === selectedKeyId.value) || null
  ))

  function readImageStudioPreferredKeyId(): string {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_STUDIO_PREFERENCES_KEY) || '{}')
      return typeof parsed?.keyId === 'string' ? parsed.keyId : ''
    } catch {
      return ''
    }
  }

  function writeImageStudioPreferredKeyId(keyId: string) {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_STUDIO_PREFERENCES_KEY) || '{}')
      localStorage.setItem(IMAGE_STUDIO_PREFERENCES_KEY, JSON.stringify({
        ...parsed,
        keyId,
      }))
    } catch {
      // Sharing the preference with the image studio is optional.
    }
  }

  function currentNodes(): CanvasFlowNode[] {
    return nodes.value as unknown as CanvasFlowNode[]
  }

  function findNode(id: string): CanvasFlowNode | undefined {
    for (const node of currentNodes()) {
      if (node.id === id) return node
    }
    return undefined
  }

  function clearSaveTimer() {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function scheduleSave() {
    if (hydrating || !project.value) return
    clearSaveTimer()
    saveState.value = 'idle'
    saveTimer = window.setTimeout(() => {
      void saveProject()
    }, AUTOSAVE_DELAY_MS)
  }

  function serializeGraph(): CanvasGraph {
    const serializedNodes: CanvasGraphNode[] = []
    for (const node of nodes.value as unknown as CanvasGraphNode[]) {
      serializedNodes.push({
        id: node.id,
        type: node.type,
        position: { x: Number(node.position.x), y: Number(node.position.y) },
        width: Number(node.width) || undefined,
        height: Number(node.height) || undefined,
        data: { ...node.data },
      })
    }
    const serializedEdges: CanvasGraphEdge[] = []
    for (const edge of edges.value as unknown as CanvasGraphEdge[]) {
      serializedEdges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: edge.type,
        animated: edge.animated,
      })
    }
    return {
      nodes: serializedNodes,
      edges: serializedEdges,
      viewport: { ...viewport.value },
    }
  }

  async function saveProject(): Promise<boolean> {
    if (!project.value || hydrating) return true
    clearSaveTimer()
    saveState.value = 'saving'
    saveError.value = ''
    try {
      const updated = await canvasProjectAPI.update(project.value.id, {
        expected_version: project.value.version,
        title: project.value.title,
        graph: serializeGraph(),
      })
      project.value = updated
      saveState.value = 'saved'
      return true
    } catch (error) {
      saveState.value = 'error'
      saveError.value = errorMessage(error)
      return false
    }
  }

  async function loadProject(id: string): Promise<void> {
    clearSaveTimer()
    loading.value = true
    hydrating = true
    generationError.value = ''
    resumedTaskIds.clear()
    try {
      const loaded = await canvasProjectAPI.get(id)
      project.value = loaded
      nodes.value = Array.isArray(loaded.graph?.nodes)
        ? loaded.graph.nodes as unknown as CanvasFlowNode[]
        : []
      edges.value = Array.isArray(loaded.graph?.edges) ? loaded.graph.edges : []
      viewport.value = loaded.graph?.viewport || { x: 0, y: 0, zoom: 1 }
      await loadGenerationContext()
      resumePendingTasks()
      saveState.value = 'saved'
    } finally {
      loading.value = false
      hydrating = false
    }
  }

  async function loadGenerationContext(): Promise<void> {
    contextReady.value = false
    generationError.value = ''
    try {
      const [settings, creator] = await Promise.all([
        authAPI.getPublicSettings(),
        ensureCreatorKey('image'),
      ])
      apiBaseUrl.value = resolvePlaygroundApiEndpoint(
        settings.api_base_url || '',
        typeof window === 'undefined' ? '' : window.location.hostname,
      )
      availableKeys.value = creator.keys.filter((key) => (
        key.status === 'active'
        && key.group?.allow_image_generation !== false
      ))
      const preferredKeyId = readImageStudioPreferredKeyId()
      const preferred = availableKeys.value.find((key) => String(key.id) === preferredKeyId)
      const chosen = preferred || creator.key
      selectedKeyId.value = String(chosen.id)
      writeImageStudioPreferredKeyId(selectedKeyId.value)
      await loadModelCatalog(chosen)
      hydrateNodeModels()
      contextReady.value = true
    } catch (error) {
      generationError.value = errorMessage(error)
      throw error
    }
  }

  async function selectCreatorKey(keyId: string): Promise<void> {
    const key = availableKeys.value.find((item) => String(item.id) === keyId && item.status === 'active')
    if (!key) throw new Error('所选 API Key 不可用')
    selectedKeyId.value = keyId
    writeImageStudioPreferredKeyId(keyId)
    await loadModelCatalog(key)
    hydrateNodeModels()
  }

  async function loadModelCatalog(key: ApiKey): Promise<void> {
    const headers = { Authorization: `Bearer ${key.key}` }
    const base = apiBaseUrl.value.replace(/\/+$/, '')
    const [batchResult, genericResult] = await Promise.allSettled([
      fetch(`${base}/images/batches/models`, { headers }).then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json()
      }),
      fetch(`${base}/models`, { headers }).then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json()
      }),
    ])
    const generic = genericResult.status === 'fulfilled' ? modelIDs(genericResult.value) : []
    const imageIDs = [
      ...(batchResult.status === 'fulfilled' ? modelIDs(batchResult.value) : []),
      ...generic.filter(isImageGenerationModel),
    ]
    imageModels.value = deduplicateModels(imageIDs.filter(isImageGenerationModel))
    videoModels.value = deduplicateModels(generic.filter(isVideoModel))
    if (!imageModels.value.length && !videoModels.value.length) {
      throw new Error('当前 API Key 没有可用的图片或视频模型')
    }
  }

  function hydrateNodeModels() {
    for (const node of currentNodes()) {
      if (node.data.kind === 'text') continue
      const options = node.data.kind === 'video-generator' ? videoModels.value : imageModels.value
      if (!options.includes(node.data.model)) {
        node.data = {
          ...node.data,
          model: options[0] || '',
        }
      }
    }
  }

  function updateNodeData(id: string, patch: Partial<CanvasNodeData>) {
    const node = findNode(id)
    if (!node) return
    node.data = { ...node.data, ...patch }
    scheduleSave()
  }

  function addNode(kind: CanvasNodeKind, position = { x: 120, y: 120 }): CanvasFlowNode {
    const defaults = defaultNodeData(kind)
    const node: CanvasFlowNode = {
      id: createNodeID(kind),
      type: kind,
      position,
      data: defaults,
      width: kind === 'text' ? 280 : 330,
      height: kind === 'text' ? 170 : 410,
    }
    nodes.value = [...currentNodes(), node]
    scheduleSave()
    return node
  }

  function defaultNodeData(kind: CanvasNodeKind): CanvasNodeData {
    if (kind === 'text') {
      return {
        kind,
        label: '文本',
        prompt: '',
        model: '',
        status: 'idle',
      }
    }
    if (kind === 'video-generator') {
      return {
        kind,
        label: '视频生成',
        prompt: '',
        model: videoModels.value[0] || '',
        status: 'idle',
        durationSeconds: VIDEO_DEFAULT_DURATION,
        aspectRatio: VIDEO_DEFAULT_ASPECT_RATIO,
      }
    }
    return {
      kind,
      label: '图片生成',
      prompt: '',
      model: imageModels.value[0] || '',
      status: 'idle',
      size: IMAGE_DEFAULT_SIZE,
    }
  }

  function removeNode(id: string) {
    const remainingNodes: CanvasFlowNode[] = []
    for (const node of currentNodes()) {
      if (node.id !== id) remainingNodes.push(node)
    }
    nodes.value = remainingNodes
    const remainingEdges: CanvasFlowEdge[] = []
    for (const edge of edges.value as unknown as CanvasFlowEdge[]) {
      if (edge.source !== id && edge.target !== id) remainingEdges.push(edge)
    }
    edges.value = remainingEdges
    scheduleSave()
  }

  function connect(params: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
    if (!params.source || !params.target || params.source === params.target) return
    const currentEdges = edges.value as unknown as CanvasFlowEdge[]
    if (currentEdges.some((edge) => edge.source === params.source && edge.target === params.target)) return
    edges.value = [...currentEdges, {
      id: createEdgeID(),
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle || undefined,
      targetHandle: params.targetHandle || undefined,
      type: 'smoothstep',
      animated: false,
    }]
    scheduleSave()
  }

  function incomingImageReferences(nodeID: string): CanvasImageReference[] {
    const sourceIDs = new Set<string>()
    for (const edge of edges.value as unknown as CanvasFlowEdge[]) {
      if (edge.target === nodeID) sourceIDs.add(edge.source)
    }
    const references: CanvasImageReference[] = []
    for (const node of currentNodes()) {
      if (!sourceIDs.has(node.id) || !node.data.resultUrl) continue
      references.push({
        id: node.id,
        url: String(node.data.resultUrl),
        name: node.data.label,
      })
    }
    return references
  }

  async function generateNode(id: string): Promise<void> {
    const node = findNode(id)
    if (!node || !creatorKey.value || !apiBaseUrl.value) {
      throw new Error('生成服务尚未就绪')
    }
    if (!node.data.prompt.trim() && node.data.kind !== 'image-asset') {
      throw new Error('请先填写提示词')
    }
    if (!node.data.model.trim() && node.data.kind !== 'text') {
      throw new Error('请先选择模型')
    }
    if (node.data.kind === 'image-generator') {
      await generateImageNode(node)
    } else if (node.data.kind === 'video-generator') {
      await generateVideoNode(node)
    }
  }

  async function generateImageNode(node: CanvasFlowNode): Promise<void> {
    updateNodeData(node.id, { status: 'running', error: '', taskId: '', pollUrl: '', resultUrl: '' })
    const references = incomingImageReferences(node.id)
    const key = creatorKey.value!
    const taskID = `${node.id}-${Date.now()}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key.key}`,
      'Idempotency-Key': taskID,
    }
    let response: Response
    try {
      if (node.data.model.toLowerCase().includes('gemini')) {
        const parts: any[] = []
        for (let index = 0; index < references.length; index += 1) {
          const dataURL = await fetchURLAsDataURL(references[index].url)
          const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataURL)
          if (!match) continue
          parts.push({ text: `图片${index + 1}` })
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
        }
        parts.push({ text: node.data.prompt.trim() })
        headers['Content-Type'] = 'application/json'
        response = await fetch(`${apiBaseUrl.value.replace(/\/+$/, '')}/images/generations/async`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: node.data.model,
            request: {
              contents: [{ role: 'user', parts }],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: { aspectRatio: '1:1' },
              },
            },
          }),
        })
      } else if (references.length) {
        const form = new FormData()
        form.append('model', node.data.model)
        form.append('prompt', node.data.prompt.trim())
        form.append('size', node.data.size || IMAGE_DEFAULT_SIZE)
        form.append('n', '1')
        form.append('response_format', 'b64_json')
        for (let index = 0; index < references.length; index += 1) {
          const blob = await fetchURLAsBlob(references[index].url)
          form.append('image[]', blob, references[index].name || `image-${index + 1}.png`)
        }
        response = await fetch(`${apiBaseUrl.value.replace(/\/+$/, '')}/images/edits/async`, {
          method: 'POST',
          headers,
          body: form,
        })
      } else {
        headers['Content-Type'] = 'application/json'
        response = await fetch(`${apiBaseUrl.value.replace(/\/+$/, '')}/images/generations/async`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: node.data.model,
            prompt: node.data.prompt.trim(),
            size: node.data.size || IMAGE_DEFAULT_SIZE,
            n: 1,
            response_format: 'b64_json',
          }),
        })
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw taskError(payload)
      const task = taskPayload(payload)
      const remoteTaskID = String(task?.task_id || task?.id || '').trim()
      const pollURL = String(task?.poll_url || response.headers.get('Location') || '').trim()
        || `/images/tasks/${encodeURIComponent(remoteTaskID)}`
      updateNodeData(node.id, { taskId: remoteTaskID, pollUrl: pollURL })
      const result = await pollImageTask(node.id, pollURL)
      const persistedURL = await persistImageResult(node, result)
      updateNodeData(node.id, {
        status: 'completed',
        resultUrl: persistedURL,
        taskId: '',
        pollUrl: '',
      })
    } catch (error) {
      updateNodeData(node.id, { status: 'failed', error: errorMessage(error) })
      throw error
    }
  }

  async function pollImageTask(nodeID: string, pollURL: string): Promise<{ url?: string; dataURL?: string }> {
    const key = creatorKey.value!
    const deadline = Date.now() + 30 * 60 * 1000
    let failures = 0
    while (Date.now() < deadline) {
      if (!findNode(nodeID)) throw new Error('节点已删除')
      let response: Response
      try {
        response = await fetch(resolveGatewayURL(pollURL), {
          headers: { Authorization: `Bearer ${key.key}` },
        })
      } catch {
        failures += 1
        await wait(Math.min(30_000, 1500 * 2 ** Math.min(failures - 1, 4)))
        continue
      }
      const payload = await response.json().catch(() => null)
      if (response.status === 429 || response.status >= 500) {
        failures += 1
        await wait(Math.min(30_000, 1500 * 2 ** Math.min(failures - 1, 4)))
        continue
      }
      if (!response.ok) throw taskError(payload)
      failures = 0
      const task = taskPayload(payload)
      if (task?.status === 'failed') throw taskError(task.error || task)
      if (task?.status === 'completed') {
        const result = typeof task.result === 'string' ? JSON.parse(task.result) : task.result
        const image = extractImageResult(result)
        if (!image.url && !image.dataURL) throw new Error('图片任务已完成，但没有返回图片')
        return image
      }
      await wait(2000)
    }
    throw new Error('图片生成超时')
  }

  async function persistImageResult(
    node: CanvasFlowNode,
    result: { url?: string; dataURL?: string },
  ): Promise<string> {
    if (result.url) {
      try {
        const entry = await imageStudioGalleryAPI.save({
          image_url: result.url,
          prompt: node.data.prompt,
          model: node.data.model,
          size: node.data.size || IMAGE_DEFAULT_SIZE,
          format: 'png',
          saved: true,
        })
        return entry.url
      } catch {
        return result.url
      }
    }
    if (result.dataURL) {
      const entry = await imageStudioGalleryAPI.save({
        image_data_url: result.dataURL,
        prompt: node.data.prompt,
        model: node.data.model,
        size: node.data.size || IMAGE_DEFAULT_SIZE,
        format: 'png',
        saved: true,
      })
      return entry.url
    }
    throw new Error('生成结果为空')
  }

  async function generateVideoNode(node: CanvasFlowNode): Promise<void> {
    updateNodeData(node.id, { status: 'running', error: '', taskId: '', taskProvider: undefined, resultUrl: '' })
    const key = creatorKey.value!
    const context = { baseUrl: apiBaseUrl.value, apiKey: key.key }
    const references = incomingImageReferences(node.id)
    try {
      const task = await createVideoTask(context, {
        model: node.data.model,
        prompt: node.data.prompt.trim(),
        durationSeconds: node.data.durationSeconds || VIDEO_DEFAULT_DURATION,
        resolution: VIDEO_DEFAULT_RESOLUTION,
        aspectRatio: node.data.aspectRatio || VIDEO_DEFAULT_ASPECT_RATIO,
        generateAudio: false,
        images: references.map((item, index) => ({
          id: index + 1,
          kind: 'image',
          name: item.name || `图片${index + 1}`,
          url: item.url,
          role: index === 0 ? 'first_frame' : 'reference_image',
        })),
        videos: [],
        audios: [],
      })
      updateNodeData(node.id, {
        taskId: task.requestId,
        taskProvider: task.provider,
      })
      const snapshot = await pollVideoTask(context, task.provider, task.requestId, {
        timeoutMs: 20 * 60 * 1000,
        intervalMs: 3000,
      })
      if (snapshot.status === 'failed') {
        throw new Error(snapshot.errorMessage || '视频生成失败')
      }
      if (!snapshot.videoUrl) throw new Error('视频任务已完成，但没有返回视频')
      const archivedURL = await persistVideoResult(node, task.provider, task.requestId, snapshot.videoUrl)
      updateNodeData(node.id, {
        status: 'completed',
        resultUrl: archivedURL,
        taskId: '',
      })
    } catch (error) {
      updateNodeData(node.id, { status: 'failed', error: errorMessage(error) })
      throw error
    }
  }

  async function persistVideoResult(
    node: CanvasFlowNode,
    provider: VideoProvider,
    requestId: string,
    videoURL: string,
  ): Promise<string> {
    const key = creatorKey.value!
    const context = { baseUrl: apiBaseUrl.value, apiKey: key.key }
    const requestURL = videoURL
    let dataURL = ''
    if (provider === 'grok') {
      try {
        const playable = await fetchVideoPlayableUrl(context, provider, requestId, videoURL)
        const response = await fetch(playable.url)
        if (response.ok) {
          dataURL = await blobToDataURL(await response.blob())
        }
      } catch {
        // Fall back to server-side URL fetching below.
      }
    }
    const entry = await archiveVideo({
      ...(dataURL ? { video_data_url: dataURL } : { video_url: requestURL }),
      prompt: node.data.prompt,
      model: node.data.model,
      format: 'mp4',
      duration_seconds: node.data.durationSeconds || VIDEO_DEFAULT_DURATION,
      saved: true,
    })
    return entry.url
  }

  function resumePendingTasks() {
    for (const node of currentNodes()) {
      if (node.data.status !== 'running' || !node.data.taskId) continue
      const key = `${node.id}:${node.data.taskId}`
      if (resumedTaskIds.has(key)) continue
      resumedTaskIds.add(key)
      if (node.data.kind === 'image-generator' && node.data.pollUrl) {
        void pollImageTask(node.id, node.data.pollUrl)
          .then((result) => persistImageResult(node, result))
          .then((url) => updateNodeData(node.id, {
            status: 'completed',
            resultUrl: url,
            taskId: '',
            pollUrl: '',
          }))
          .catch((error) => updateNodeData(node.id, {
            status: 'failed',
            error: errorMessage(error),
          }))
      } else if (node.data.kind === 'video-generator' && node.data.taskProvider) {
        const keyData = creatorKey.value
        if (!keyData) continue
        const context = { baseUrl: apiBaseUrl.value, apiKey: keyData.key }
        void pollVideoTask(context, node.data.taskProvider, node.data.taskId, {
          timeoutMs: 20 * 60 * 1000,
          intervalMs: 3000,
        })
          .then(async (snapshot) => {
            if (snapshot.status === 'failed') throw new Error(snapshot.errorMessage || '视频生成失败')
            if (!snapshot.videoUrl) throw new Error('视频结果为空')
            return persistVideoResult(node, node.data.taskProvider!, node.data.taskId!, snapshot.videoUrl)
          })
          .then((url) => updateNodeData(node.id, {
            status: 'completed',
            resultUrl: url,
            taskId: '',
          }))
          .catch((error) => updateNodeData(node.id, {
            status: 'failed',
            error: errorMessage(error),
          }))
      }
    }
  }

  function resolveGatewayURL(raw: string): string {
    if (/^https?:\/\//i.test(raw)) return raw
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
    return new URL(raw, origin).toString()
  }

  async function fetchURLAsBlob(url: string): Promise<Blob> {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) throw new Error(`读取参考图失败：${response.status}`)
    return response.blob()
  }

  async function fetchURLAsDataURL(url: string): Promise<string> {
    return blobToDataURL(await fetchURLAsBlob(url))
  }

  return {
    project,
    nodes,
    edges,
    viewport,
    loading,
    saveState,
    saveError,
    generationError,
    imageModels,
    videoModels,
    apiBaseUrl,
    creatorKey,
    availableKeys,
    selectedKeyId,
    contextReady,
    projectId,
    title,
    version,
    hasModels,
    loadProject,
    selectCreatorKey,
    saveProject,
    scheduleSave,
    updateNodeData,
    addNode,
    removeNode,
    connect,
    generateNode,
    incomingImageReferences,
  }
})
