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

### Task 5: Extract Gateway Task Transport

**Files:**
- Create: `frontend/src/features/image-studio/imageTaskTransport.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageTaskTransport.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: raw Gateway and async task payloads.
- Produces: `gatewayTaskPayload(payload)`, `gatewayPollUrlForTask(task, apiBaseUrl)`, `resolveGatewayPollUrl(raw, apiBaseUrl, fallbackOrigin)`, `gatewayTaskState(task)`, and `GatewayTaskState`.

- [x] **Step 1: Write failing tests for response unwrapping, poll URL resolution, and status classification**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskTransport.spec.ts`
Expected: FAIL because `imageTaskTransport.ts` does not exist.

- [x] **Step 2: Implement the task transport helpers**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskTransport.spec.ts`
Expected: PASS with 6 tests.

- [x] **Step 3: Replace duplicate helpers in `ImageStudioView.vue`**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskState.spec.ts src/features/image-studio/__tests__/imageTaskTransport.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 134 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 6: Isolate Gallery Stability Rules

**Files:**
- Create: `frontend/src/features/image-studio/imageGalleryState.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageGalleryState.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: stored image URLs, display order values, and image identity lists.
- Produces: `sameStoredObject(current, next, origin)`, `stableDisplayOrder(current, incoming)`, and `sameImageIdentityOrder(current, next)`.

- [x] **Step 1: Write failing tests for signed URL rotation and stable slots**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGalleryState.spec.ts`
Expected: FAIL because `imageGalleryState.ts` does not exist.

- [x] **Step 2: Implement the gallery stability helpers**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGalleryState.spec.ts`
Expected: PASS with 5 tests.

- [x] **Step 3: Replace duplicate gallery rules in `ImageStudioView.vue`**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGalleryState.spec.ts src/features/image-studio/__tests__/imageTaskTransport.spec.ts src/features/image-studio/__tests__/imageTaskState.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 139 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 7: Extract Image Task Client

**Files:**
- Create: `frontend/src/features/image-studio/imageTaskClient.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageTaskClient.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: API base URL, headers, idempotency keys, and request timeouts.
- Produces: async-submit URL mapping, idempotency lookup URL, timeout-aware fetch, transient error/status checks, and idempotency recovery.

- [x] **Step 1: Write failing client tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskClient.spec.ts`
Expected: FAIL because `imageTaskClient.ts` does not exist.

- [x] **Step 2: Implement and verify the client**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskClient.spec.ts`
Expected: PASS with 8 tests.

- [x] **Step 3: Replace duplicate client helpers in the page**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskClient.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 125 tests.

### Task 8: Extract User-Scoped Persistence

**Files:**
- Create: `frontend/src/features/image-studio/imageStudioPersistence.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageStudioPersistence.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: browser `Storage` objects, user ids, preference updates, and compact snapshots.
- Produces: user-scoped storage keys, validated preference/snapshot reads, and safe writes.

- [x] **Step 1: Write failing persistence tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageStudioPersistence.spec.ts`
Expected: FAIL because `imageStudioPersistence.ts` does not exist.

- [x] **Step 2: Implement and verify persistence**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageStudioPersistence.spec.ts`
Expected: PASS with 5 tests.

- [x] **Step 3: Replace duplicate storage helpers in the page**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageStudioPersistence.spec.ts src/features/image-studio/__tests__/imageTaskClient.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 130 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 9: Extract Generation Queue Primitives

**Files:**
- Create: `frontend/src/features/image-studio/imageGenerationQueue.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageGenerationQueue.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: requested count, current display-order cursor, task factory, generation settings, and pending task lists.
- Produces: `normalizeImageRequestCount`, `allocateImageBatchDisplayOrder`, `createPendingImageBatch`, `failImageTask`, and `removePendingTaskImages`.

- [x] **Step 1: Write failing queue tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGenerationQueue.spec.ts`
Expected: FAIL because `imageGenerationQueue.ts` does not exist.

- [x] **Step 2: Implement and verify queue primitives**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGenerationQueue.spec.ts`
Expected: PASS with 5 tests.

- [x] **Step 3: Replace inline batch construction and failure mutation**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGenerationQueue.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 122 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 10: Move Gateway Polling Into The Client

**Files:**
- Modify: `frontend/src/features/image-studio/imageTaskClient.ts`
- Modify: `frontend/src/features/image-studio/__tests__/imageTaskClient.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: poll URL, headers, API base URL, image extractor, deadline, preview callback, fetch, clock, and wait function.
- Produces: `pollGatewayImageTask` with shared preview, retry, cancellation, and terminal-state handling.

- [x] **Step 1: Write failing poll tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskClient.spec.ts`
Expected: FAIL because `pollGatewayImageTask` is missing.

- [x] **Step 2: Implement and verify polling**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskClient.spec.ts`
Expected: PASS with 10 tests.

- [x] **Step 3: Replace the page polling loop with the client**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageTaskClient.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 127 tests.

### Task 11: Extract Request Construction

**Files:**
- Create: `frontend/src/features/image-studio/imageRequestBuilder.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageRequestBuilder.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: API base URL, model, platform, prompt, references, size, quality, format, and background.
- Produces: Gemini URL/payload, edit URL payload, multipart edit form, result extraction, and aspect-ratio helpers.

- [x] **Step 1: Write failing request-builder tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageRequestBuilder.spec.ts`
Expected: FAIL because `imageRequestBuilder.ts` does not exist.

- [x] **Step 2: Implement and verify request construction**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageRequestBuilder.spec.ts`
Expected: PASS with 6 tests.

- [x] **Step 3: Replace duplicate builders in the page**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageRequestBuilder.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 123 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 12: Extract Error Mapping

**Files:**
- Create: `frontend/src/features/image-studio/imageStudioErrors.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageStudioErrors.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: nested API errors, HTTP status, business reasons, admin visibility.
- Produces: normalized user-facing messages and reusable nested error inspection.

- [x] **Step 1: Write failing error-mapping tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageStudioErrors.spec.ts`
Expected: FAIL because `imageStudioErrors.ts` does not exist.

- [x] **Step 2: Implement and verify error mapping**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageStudioErrors.spec.ts`
Expected: PASS with 6 tests.

- [x] **Step 3: Replace duplicate error helpers in the page**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageStudioErrors.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 123 tests.

### Task 13: Extract Size Constraints

**Files:**
- Create: `frontend/src/features/image-studio/imageSizeConstraints.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageSizeConstraints.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: raw dimensions and optional local maximum edge.
- Produces: upstream pixel-window fitting, validation, 16-pixel normalization, clamping, and parsing.

- [x] **Step 1: Write failing size-constraint tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageSizeConstraints.spec.ts`
Expected: FAIL because `imageSizeConstraints.ts` does not exist.

- [x] **Step 2: Implement and verify size constraints**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageSizeConstraints.spec.ts`
Expected: PASS with 6 tests.

- [x] **Step 3: Replace duplicate size rules in the page**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageSizeConstraints.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 123 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 14: Extract Media Source Rules

**Files:**
- Create: `frontend/src/features/image-studio/imageMediaState.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageMediaState.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: image format, source, thumbnail, retry nonce, and origin.
- Produces: animated-image detection and stable retry-aware media source resolution.

- [x] **Step 1: Write failing media source tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageMediaState.spec.ts`
Expected: FAIL because `imageMediaState.ts` does not exist.

- [x] **Step 2: Implement and verify media rules**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageMediaState.spec.ts`
Expected: PASS with 3 tests.

- [x] **Step 3: Replace duplicate media source rules**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageMediaState.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 120 tests.

### Task 15: Extract Model Policy

**Files:**
- Create: `frontend/src/features/image-studio/imageModelPolicy.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageModelPolicy.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: raw model names from settings and batch-model discovery.
- Produces: image model detection, Gemini detection, Grok image detection, and deterministic deduplication.

- [x] **Step 1: Write failing model-policy tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageModelPolicy.spec.ts`
Expected: FAIL because `imageModelPolicy.ts` does not exist.

- [x] **Step 2: Implement and verify model policy**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageModelPolicy.spec.ts`
Expected: PASS with 4 tests.

- [x] **Step 3: Replace duplicate model rules**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageModelPolicy.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 121 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.

### Task 16: Extract Gallery Merge

**Files:**
- Create: `frontend/src/features/image-studio/imageGalleryMerge.ts`
- Create: `frontend/src/features/image-studio/__tests__/imageGalleryMerge.spec.ts`
- Modify: `frontend/src/features/image-studio/ImageStudioView.vue`

**Interfaces:**
- Consumes: current generated images, server gallery entries, saved ids, local gallery mapping, URL resolver, and fallback matcher.
- Produces: merged stable images, matched local/gallery ids, and media ids requiring reload.

- [x] **Step 1: Write failing gallery-merge tests**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGalleryMerge.spec.ts`
Expected: FAIL because `imageGalleryMerge.ts` does not exist.

- [x] **Step 2: Implement and verify gallery merge**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGalleryMerge.spec.ts`
Expected: PASS with 5 tests.

- [x] **Step 3: Replace the inline merge loop**

Run: `pnpm exec vitest run src/features/image-studio/__tests__/imageGalleryMerge.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts`
Expected: PASS with 122 tests.

- [x] **Step 4: Run type checking**

Run: `pnpm run typecheck`
Expected: exit 0.
