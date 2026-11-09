# Image Studio State Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract image task types and lifecycle projection from the monolithic image studio page without changing behavior.

**Architecture:** Add dependency-free type and state modules, prove the deterministic phase projection with unit tests, then replace the page's active/display predicates with the shared model. Polling and gallery extraction follow in later tasks.

**Tech Stack:** Vue 3, TypeScript, Vitest, pnpm.

## Global Constraints

- Preserve existing backend image APIs, billing, and storage behavior.
- Do not commit unrelated dirty files.
- Use test-first development for new production code.
- Keep every existing image studio test green.

---

### Task 1: Extract Image Studio Types

**Files:**
- Create: `frontend/src/features/image-studio/imageStudioTypes.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`
- Test: `frontend/src/features/image-studio/__tests__/ImageStudioView.spec.ts`

**Interfaces:**
- Produces: `GeneratedImage`, `GenerationRequestSnapshot`, `ReferenceItem`, `SizeMode`, and `SizeSettings`.
- Consumes: no runtime dependencies.

- [x] **Step 1: Move the type declarations without changing their fields**

```ts
export interface GeneratedImage {
  id: number | string
  title: string
  src: string
  pending?: boolean
  taskId?: string
  galleryId?: string
  // Remaining fields copied verbatim from ImageStudioView.vue.
}
```

- [x] **Step 2: Import the types in `ImageStudioView.vue`**

```ts
import type {
  GeneratedImage,
  GenerationRequestSnapshot,
  ReferenceItem,
  SizeMode,
  SizeSettings,
} from './imageStudioTypes'
```

- [x] **Step 3: Run the existing image studio suite**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 117 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 2: Add Deterministic Task Phase Projection

**Files:**
- Create: `frontend/src/features/image-studio/imageTaskState.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageTaskState.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: `GeneratedImage` from Task 1.
- Produces: `ImageTaskPhase`, `resolveImageTaskPhase(image)`, `isImageTaskActive(image)`, `isImageTaskDisplayReady(image)`, `imageTaskIdentity(image)`, and `imageTaskSlotIdentity(image, slot)`.

- [x] **Step 1: Write failing tests for phase precedence**

```ts
it('prefers a renderable preview while persistence is still pending', () => {
  expect(resolveImageTaskPhase({ pending: true, previewSrc: 'blob:preview' }))
    .toBe('preview_ready')
})

it('treats a failed task as terminal even if a stale pending flag remains', () => {
  expect(resolveImageTaskPhase({ failed: true, pending: true }))
    .toBe('failed')
})
```

- [x] **Step 2: Run the new test and verify it fails**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskState.spec.ts`
Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the minimal projection**

```ts
export type ImageTaskPhase =
  | 'submitted'
  | 'generating'
  | 'preview_ready'
  | 'persisted'
  | 'failed'
  | 'uncertain'
```

- [x] **Step 4: Run the new test and verify it passes**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskState.spec.ts`
Expected: PASS.

### Task 3: Replace Page-Level Active Predicates

**Files:**
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`
- Test: `frontend/src/features/image-studio/__tests__/ImageStudioView.spec.ts`

**Interfaces:**
- Consumes: task phase predicates from Task 2.
- Produces: one page-level definition of active image work.

- [x] **Step 1: Replace independent pending checks used by active counts**

```ts
const activeImageTaskCount = computed(() => (
  images.value.filter(isImageTaskActive).length
))
const hasActiveImageGeneration = computed(() => (
  generating.value
  || activeGenerations.value > 0
  || activeImageTaskCount.value > 0
))
```

- [x] **Step 2: Run the image studio suite**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 117 tests.

- [x] **Step 3: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 4: Commit The First Refactor Slice

**Files:**
- Add: `docs/superpowers/specs/2026-11-09-image-studio-state-refactor-design.md`
- Add: `docs/superpowers/plans/2026-11-09-image-studio-state-refactor.md`
- Add: `frontend/src/features/image-studio/imageStudioTypes.ts`
- Add: `frontend/src/features/image-studio/imageTaskState.ts`
- Add: `frontend/src/features/image-studio/__tests__/imageTaskState.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

- [x] **Step 1: Review the scoped diff**

Run: `git diff --check`
Expected: no whitespace errors.

- [x] **Step 2: Commit only the refactor files**

```bash
git add docs/superpowers/specs/2026-11-09-image-studio-state-refactor-design.md \
  docs/superpowers/plans/2026-11-09-image-studio-state-refactor.md \
  frontend/src/features/image-studio/imageStudioTypes.ts \
  frontend/src/features/image-studio/imageTaskState.ts \
  frontend/src/features/image-studio/__tests__/imageTaskState.spec.ts \
  frontend/src/features/image-studio/ImageStudioView.vue
git commit -m "refactor: establish image task state model"
```
