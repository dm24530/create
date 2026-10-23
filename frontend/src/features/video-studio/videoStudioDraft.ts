import { reactive } from 'vue'

import type { VideoReferenceAsset } from './videoStudioApi'

export interface VideoStudioDraftState {
  ownerId: string
  initialized: boolean
  prompt: string
  references: VideoReferenceAsset[]
}

export const videoStudioDraft = reactive<VideoStudioDraftState>({
  ownerId: '',
  initialized: false,
  prompt: '',
  references: [],
})

export function resetVideoStudioDraft() {
  videoStudioDraft.ownerId = ''
  videoStudioDraft.initialized = false
  videoStudioDraft.prompt = ''
  videoStudioDraft.references = []
}
