import type { Edge, Node, ViewportTransform, XYPosition } from '@vue-flow/core'

export type CanvasNodeKind = 'image-generator' | 'video-generator' | 'text' | 'image-asset'

export type CanvasNodeStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface CanvasImageReference {
  id: string
  url: string
  name?: string
}

export interface CanvasNodeData {
  kind: CanvasNodeKind
  label: string
  prompt: string
  model: string
  status: CanvasNodeStatus
  error?: string
  resultUrl?: string
  resultGalleryId?: string
  taskId?: string
  pollUrl?: string
  taskProvider?: 'seedance' | 'grok'
  size?: string
  aspectRatio?: string
  durationSeconds?: number
  referenceImages?: CanvasImageReference[]
}

export type CanvasFlowNode = Omit<Node<CanvasNodeData>, 'data'> & { data: CanvasNodeData }
export type CanvasFlowEdge = Edge

export interface CanvasGraphNode {
  id: string
  type?: string
  position: XYPosition
  width?: number
  height?: number
  data: CanvasNodeData
}

export interface CanvasGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  animated?: boolean
}

export interface CanvasGraph {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
  viewport?: ViewportTransform
}

export interface CanvasProjectSummary {
  id: string
  title: string
  version: number
  created_at: string
  updated_at: string
}

export interface CanvasProject {
  id: string
  title: string
  graph: CanvasGraph
  version: number
  created_at: string
  updated_at: string
}
