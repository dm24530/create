import { apiClient } from './client'
import type { CanvasGraph, CanvasProject, CanvasProjectSummary } from '@/types/canvas'

export interface CreateCanvasProjectRequest {
  title: string
  graph?: CanvasGraph
}

export interface UpdateCanvasProjectRequest {
  expected_version: number
  title: string
  graph: CanvasGraph
}

export async function listCanvasProjects(): Promise<CanvasProjectSummary[]> {
  const { data } = await apiClient.get<CanvasProjectSummary[]>('/canvas/projects')
  return Array.isArray(data) ? data : []
}

export async function createCanvasProject(request: CreateCanvasProjectRequest): Promise<CanvasProject> {
  const { data } = await apiClient.post<CanvasProject>('/canvas/projects', request)
  return data
}

export async function getCanvasProject(id: string): Promise<CanvasProject> {
  const { data } = await apiClient.get<CanvasProject>(`/canvas/projects/${encodeURIComponent(id)}`)
  return data
}

export async function updateCanvasProject(
  id: string,
  request: UpdateCanvasProjectRequest,
): Promise<CanvasProject> {
  const { data } = await apiClient.patch<CanvasProject>(
    `/canvas/projects/${encodeURIComponent(id)}`,
    request,
  )
  return data
}

export async function deleteCanvasProject(id: string): Promise<void> {
  await apiClient.delete(`/canvas/projects/${encodeURIComponent(id)}`)
}

export const canvasProjectAPI = {
  list: listCanvasProjects,
  create: createCanvasProject,
  get: getCanvasProject,
  update: updateCanvasProject,
  delete: deleteCanvasProject,
}

export default canvasProjectAPI
