import { reactive } from 'vue'

export const IMAGE_STUDIO_DEFAULT_PROMPT = '一只趴在桌上的橙色小猫，柔和窗边自然光，电影感，极简背景'

export interface ImageStudioDraftReference {
  id: number
  name: string
  file: File
  preview: string
}

export interface ImageStudioDraftState {
  ownerId: string
  initialized: boolean
  prompt: string
  references: ImageStudioDraftReference[]
}

export const imageStudioDraft = reactive<ImageStudioDraftState>({
  ownerId: '',
  initialized: false,
  prompt: IMAGE_STUDIO_DEFAULT_PROMPT,
  references: [],
})

export function resetImageStudioDraft() {
  imageStudioDraft.ownerId = ''
  imageStudioDraft.initialized = false
  imageStudioDraft.prompt = IMAGE_STUDIO_DEFAULT_PROMPT
  imageStudioDraft.references = []
}
