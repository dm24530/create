# Product Detail Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent local-first product detail page workbench with conversational planning, user design skills, storyboard generation, image generation, deterministic 750px rendering, and ZIP export.

**Architecture:** Add a dedicated `/product-detail` React page and local product-detail domain module. Pure functions own brief merging, dialogue parsing, storyboard planning, skill extraction, page layout and validation. A user-scoped localforage store persists projects, conversations and skills. Existing model APIs and local image storage are reused only as infrastructure; no image/video/canvas state is shared.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, localforage, Ant Design, Vitest, Canvas, fflate, file-saver.

## Global Constraints

- Route is exactly `/product-detail`.
- Navigation label is `商品详情`, placed after `无限画布` and before `我的资产`.
- User-visible name is `详情页工作台`; it must not be mixed with image, video or canvas workbench state.
- First version supports 淘宝/天猫, 京东, 拼多多 at 750px width.
- Skill storage is local only and scoped by the current logged-in user.
- No cloud sync, version bump, packaging, push, PSD, Figma, drag-and-drop editor or overseas platforms.
- Generated images and exports are local; server is only used for model requests.
- No generated HTML/CSS/JS is executed.
- All text input is rendered as plain text.
- All new behavior starts with a failing test.

---

### Task 1: Domain Model and Pure Helpers

**Files:**
- Create: `web/src/types/product-detail.ts`
- Create: `web/src/lib/product-detail/defaults.ts`
- Create: `web/src/lib/product-detail/brief.ts`
- Create: `web/src/lib/product-detail/skills.ts`
- Test: `web/src/lib/product-detail/__tests__/brief.spec.ts`
- Test: `web/src/lib/product-detail/__tests__/skills.spec.ts`

**Interfaces:**
- Produces: `createEmptyBrief(platform): ProductBrief`
- Produces: `mergeProductBrief(brief, patch): ProductBrief`
- Produces: `isProductBriefReady(brief): boolean`
- Produces: `applyDesignSkill(brief, skill): ProductBrief`
- Produces: `buildSkillCandidate(project): UserDesignSkill`

- [ ] **Step 1: Write failing brief tests**

```ts
it("keeps confirmed facts and replaces changed fields", () => {
  const brief = createEmptyBrief("taobao");
  const next = mergeProductBrief(brief, {
    productName: "便携榨汁杯",
    sellingPoints: [{ id: "s1", text: "一键榨汁", source: "user" }],
  });
  expect(next.productName).toBe("便携榨汁杯");
  expect(next.revision).toBe(1);
  expect(isProductBriefReady(next)).toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/brief.spec.ts`

Expected: fail because product-detail domain modules do not exist.

- [ ] **Step 3: Implement types and pure functions**

Implement exact types from the design document. `mergeProductBrief` increments revision, merges arrays by explicit replacement and clears fields set to empty strings. `isProductBriefReady` requires product name, category, platform, one target audience and one confirmed selling point.

- [ ] **Step 4: Write failing Skill tests**

```ts
it("builds a reusable skill only from confirmed project preferences", () => {
  const skill = buildSkillCandidate(projectFixture);
  expect(skill.enabled).toBe(true);
  expect(skill.brand.colors).toEqual(["#111111"]);
  expect(skill.copy.forbiddenPhrases).toContain("包治百病");
});
```

- [ ] **Step 5: Run Skill test RED, implement, verify GREEN**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/skills.spec.ts`

Expected after implementation: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/types/product-detail.ts web/src/lib/product-detail web/src/lib/product-detail/__tests__
git commit -m "feat: add product detail domain model"
```

---

### Task 2: User-Scoped Local Persistence

**Files:**
- Create: `web/src/services/product-detail/storage.ts`
- Create: `web/src/stores/use-product-detail-store.ts`
- Test: `web/src/lib/product-detail/__tests__/workspace.spec.ts`

**Interfaces:**
- Produces: `ProductDetailWorkspace` type
- Produces: `createEmptyWorkspace(): ProductDetailWorkspace`
- Produces: `upsertProject(workspace, project): ProductDetailWorkspace`
- Produces: `removeProject(workspace, projectId): ProductDetailWorkspace`
- Produces: `upsertSkill(workspace, skill): ProductDetailWorkspace`
- Produces: `removeSkill(workspace, skillId): ProductDetailWorkspace`

- [ ] **Step 1: Write failing workspace tests**

```ts
it("does not mix projects or skills between workspace instances", () => {
  const workspace = createEmptyWorkspace();
  const next = upsertProject(workspace, projectFixture);
  expect(next.projects).toHaveLength(1);
  expect(upsertSkill(next, skillFixture).skills).toHaveLength(1);
  expect(removeProject(next, projectFixture.id).projects).toHaveLength(0);
});
```

- [ ] **Step 2: Run RED**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/workspace.spec.ts`

Expected: fail because workspace helpers are missing.

- [ ] **Step 3: Implement localforage storage and Zustand store**

Use `scopedCanvasStoreName("product_detail_workbench")`. Store one `workspace` record per current user scope. Store actions must autosave after every mutation.

- [ ] **Step 4: Verify GREEN and typecheck**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/workspace.spec.ts`

Run: `npm --prefix web run typecheck`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/services/product-detail/storage.ts web/src/stores/use-product-detail-store.ts web/src/lib/product-detail/__tests__/workspace.spec.ts
git commit -m "feat: persist product detail workspace locally"
```

---

### Task 3: Conversational Brief Engine

**Files:**
- Create: `web/src/lib/product-detail/conversation.ts`
- Create: `web/src/services/product-detail/conversation.ts`
- Test: `web/src/lib/product-detail/__tests__/conversation.spec.ts`

**Interfaces:**
- Produces: `parseProductDetailAssistantTurn(raw: string): ProductDetailAssistantTurn`
- Produces: `buildProductDetailConversationMessages(state): AiTextMessage[]`
- Produces: `requestProductDetailTurn(config, state, signal): Promise<ProductDetailAssistantTurn>`
- Produces: `fallbackProductDetailTurn(brief): ProductDetailAssistantTurn`

- [ ] **Step 1: Write failing parser tests**

```ts
it("parses a fenced structured assistant response", () => {
  const turn = parseProductDetailAssistantTurn('```json\n{"message":"请补充目标人群","readyToPlan":false,"assumptions":[],"risks":[]}\n```');
  expect(turn.message).toBe("请补充目标人群");
  expect(turn.readyToPlan).toBe(false);
});
```

- [ ] **Step 2: Run RED and implement minimal parser**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/conversation.spec.ts`

Implement JSON extraction, schema validation and a safe fallback that turns malformed output into a user-facing retry message.

- [ ] **Step 3: Implement model request**

Reuse `requestImageQuestion` with `{ ...config, model: config.textModel }`. Send structured Brief, selected Skill summary and at most 10 recent dialogue messages. No hidden chain-of-thought is displayed.

- [ ] **Step 4: Verify GREEN**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/conversation.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/product-detail/conversation.ts web/src/services/product-detail/conversation.ts web/src/lib/product-detail/__tests__/conversation.spec.ts
git commit -m "feat: add product detail conversation engine"
```

---

### Task 4: Storyboard Planner and Workbench UI

**Files:**
- Create: `web/src/lib/product-detail/storyboard.ts`
- Create: `web/src/services/product-detail/storyboard.ts`
- Create: `web/src/pages/product-detail/index.tsx`
- Create: `web/src/components/product-detail/conversation-panel.tsx`
- Create: `web/src/components/product-detail/brief-panel.tsx`
- Create: `web/src/components/product-detail/storyboard-panel.tsx`
- Create: `web/src/components/product-detail/skill-manager.tsx`
- Modify: `web/src/router.tsx`
- Modify: `web/src/constant/navigation-tools.ts`
- Modify: `web/src/i18n/locales/zh-CN.ts`
- Modify: `web/src/i18n/locales/en-US.ts`
- Test: `web/src/lib/product-detail/__tests__/storyboard.spec.ts`

**Interfaces:**
- Produces: `createFallbackStoryboard(brief, skill): Storyboard`
- Produces: `reorderStoryboard(storyboard, pageId, direction): Storyboard`
- Produces: `updateStoryboardPage(storyboard, pageId, patch): Storyboard`
- Produces: `<ProductDetailPage />`
- Produces route `/product-detail`
- Produces nav item `product-detail`

- [ ] **Step 1: Write failing storyboard tests**

```ts
it("creates six to ten ordered pages and keeps hero first", () => {
  const storyboard = createFallbackStoryboard(readyBrief, skillFixture);
  expect(storyboard.pages.length).toBeGreaterThanOrEqual(6);
  expect(storyboard.pages.length).toBeLessThanOrEqual(10);
  expect(storyboard.pages[0].role).toBe("hero");
  expect(storyboard.pages.map((page) => page.order)).toEqual(
    storyboard.pages.map((_, index) => index + 1),
  );
});
```

- [ ] **Step 2: Run RED, implement fallback planner, verify GREEN**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/storyboard.spec.ts`

Implement the role sequence: hero, pain-point, core-benefit, feature-detail, scenario, specification, trust, closing. Remove trust when there is no trust fact.

- [ ] **Step 3: Add route and navigation**

Add `PackageSearch` icon, route element and translations. The page must use its own Zustand store and not read image/video/canvas result stores.

- [ ] **Step 4: Build the three-column workbench**

Left rail: projects and Skills. Center: chat composer and messages. Right: tabs for Brief, storyboard, output and export. Mobile uses tabs rather than three columns.

- [ ] **Step 5: Add editable Brief and storyboard controls**

Support edit, add, delete, reorder and single-page regeneration. Confirmation button is disabled until a storyboard exists.

- [ ] **Step 6: Verify build and UI tests**

Run: `npm --prefix web run typecheck`

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/storyboard.spec.ts`

Run: `npm --prefix web run build:desktop`

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/product-detail web/src/components/product-detail web/src/lib/product-detail/storyboard.ts web/src/services/product-detail/storyboard.ts web/src/router.tsx web/src/constant/navigation-tools.ts web/src/i18n/locales/zh-CN.ts web/src/i18n/locales/en-US.ts web/src/lib/product-detail/__tests__/storyboard.spec.ts
git commit -m "feat: add product detail workbench"
```

---

### Task 5: Product Image Generation

**Files:**
- Create: `web/src/lib/product-detail/image-prompt.ts`
- Create: `web/src/services/product-detail/image-generation.ts`
- Test: `web/src/lib/product-detail/__tests__/image-prompt.spec.ts`

**Interfaces:**
- Produces: `buildNoTextImagePrompt(page, brief, skill): string`
- Produces: `generateStoryboardImage(config, project, page): Promise<ProjectAsset>`
- Produces: `generateAllStoryboardImages(config, project, concurrency): Promise<ProjectAsset[]>`

- [ ] **Step 1: Write failing prompt test**

```ts
it("requires no text and product truth preservation", () => {
  const prompt = buildNoTextImagePrompt(pageFixture, readyBrief, skillFixture);
  expect(prompt).toContain("不得生成任何文字");
  expect(prompt).toContain("保持商品外观一致");
  expect(prompt).toContain("留出文案安全区");
});
```

- [ ] **Step 2: Run RED and implement prompt builder**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/image-prompt.spec.ts`

- [ ] **Step 3: Integrate image API**

Use `requestEdit` when product reference assets exist, otherwise `requestGeneration`. Use config `{ ...config, model: config.imageModel, count: "1" }`. Persist each returned image through `uploadImage` and project asset storage.

- [ ] **Step 4: Add concurrency and retry behavior**

Default concurrency is 2. Each page has independent status and error. Do not cancel successful pages when another page fails.

- [ ] **Step 5: Verify GREEN and typecheck**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/image-prompt.spec.ts`

Run: `npm --prefix web run typecheck`

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/product-detail/image-prompt.ts web/src/services/product-detail/image-generation.ts web/src/lib/product-detail/__tests__/image-prompt.spec.ts
git commit -m "feat: generate product detail base images"
```

---

### Task 6: Deterministic Canvas Rendering and Export

**Files:**
- Create: `web/src/lib/product-detail/layout.ts`
- Create: `web/src/lib/product-detail/renderer.ts`
- Create: `web/src/lib/product-detail/export.ts`
- Create: `web/src/components/product-detail/render-preview.tsx`
- Test: `web/src/lib/product-detail/__tests__/layout.spec.ts`
- Test: `web/src/lib/product-detail/__tests__/export.spec.ts`

**Interfaces:**
- Produces: `buildPageSpec(page, brief, skill, platform): PageSpec`
- Produces: `validatePageSpec(spec): ValidationResult[]`
- Produces: `renderPageToCanvas(spec, imageLoader): Promise<HTMLCanvasElement>`
- Produces: `stitchLongImage(canvases): HTMLCanvasElement`
- Produces: `sliceLongImage(canvas, maxHeight): HTMLCanvasElement[]`
- Produces: `exportProjectZip(project, blobs): Blob`

- [ ] **Step 1: Write failing layout tests**

```ts
it("builds a 750px page with text inside safe margins", () => {
  const spec = buildPageSpec(pageFixture, readyBrief, skillFixture, "taobao");
  expect(spec.width).toBe(750);
  expect(validatePageSpec(spec)).toEqual([]);
});
```

- [ ] **Step 2: Run RED and implement layout/validation**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/layout.spec.ts`

- [ ] **Step 3: Implement Canvas drawing**

Draw background image with cover fit, gradient overlay, accent shape, title, body copy and order badge. Wrap Chinese text using measured width. Use a deterministic system font stack.

- [ ] **Step 4: Implement preview and export**

Render pages sequentially. Provide long image preview, individual page JPEGs, slices and ZIP. Use `fflate` for packing and `saveGeneratedFile` for saving.

- [ ] **Step 5: Verify GREEN, full suite and desktop build**

Run: `npm --prefix web run test -- src/lib/product-detail/__tests__/layout.spec.ts src/lib/product-detail/__tests__/export.spec.ts`

Run: `npm test`

Run: `npm run build:desktop`

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/product-detail/layout.ts web/src/lib/product-detail/renderer.ts web/src/lib/product-detail/export.ts web/src/components/product-detail/render-preview.tsx web/src/lib/product-detail/__tests__/layout.spec.ts web/src/lib/product-detail/__tests__/export.spec.ts
git commit -m "feat: render and export product detail pages"
```

---

### Task 7: End-to-End Verification

**Files:**
- Modify: `web/src/pages/product-detail/index.tsx`
- Modify: `web/src/components/product-detail/*.tsx`
- Modify: `web/src/stores/use-product-detail-store.ts`

- [ ] **Step 1: Run full automated verification**

Run: `npm --prefix web run typecheck`

Run: `npm test`

Run: `npm run build`

Run: `npm run build:desktop`

Expected: all commands exit 0.

- [ ] **Step 2: Start local app and verify interaction flow**

Run: `npm --prefix web run dev -- --host 127.0.0.1 --port 3001`

Verify:

1. Product detail appears as a separate nav item.
2. New project opens with empty brief.
3. Manual Brief edit persists after reload.
4. Conversation input renders and stores user/assistant messages.
5. Storyboard can be generated, edited, reordered and confirmed.
6. User Skill can be created, disabled and selected.
7. Export preview produces 750px pages.
8. Image/video/canvas history remains unchanged.

- [ ] **Step 3: Visual QA**

Capture desktop and mobile screenshots of the workbench. Check text overflow, three-column layout, tab behavior and empty states. Fix any visible regression before completion.

- [ ] **Step 4: Commit final integration fixes**

```bash
git add web/src/pages/product-detail web/src/components/product-detail web/src/stores/use-product-detail-store.ts
git commit -m "fix: polish product detail workbench"
```

## Self-Review Checklist

- [x] Product detail is isolated from image, video and canvas stores.
- [x] Local-only user Skill persistence is represented.
- [x] Multi-turn conversation uses structured state, not unlimited history.
- [x] Storyboard confirmation gates image generation.
- [x] Image generation is separate from deterministic text layout.
- [x] 750px output and ZIP export are represented.
- [x] Failure, retry and persistence behavior are represented.
- [x] Version, packaging, push and cloud sync are explicitly excluded.
