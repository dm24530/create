# Image Studio Full Refactor Inventory

## Purpose

This document records the current Image Studio behavior before the full
refactor. The refactor must preserve these behaviors unless a later product
decision explicitly changes them.

## Entry And Ownership

- The page is available at `/image-studio`.
- Keys, models, settings, gallery, quota, pending tasks, failures,
  preferences, drafts, and snapshots are scoped to the authenticated user.
- Cached state must be cleared immediately when the authenticated user changes.
- A response from the previous user must never update the current user's UI.
- Older unscoped local-storage keys must not be restored for a new user.

## API Key Selection

- Load API keys independently from public settings so keys can render while
  settings are still loading.
- Show only active keys whose group allows image generation.
- Display only the selected key's name, never its secret value.
- Restore the last selected key after remount when it remains available.
- If the original key for a restored task is unavailable, report that the task
  cannot be resumed with the current key.

## Model Discovery

- Load image models automatically for the selected key.
- Merge and deduplicate models from the batch-image model endpoint and the
  regular model endpoint.
- Keep loaded keys visible if public settings fail.
- Do not show a redundant empty-model error when the service is valid but no
  image model is available.
- Restore the last selected model after remount when available.
- Refresh keys, settings, and models from the toolbar refresh action.

## Prompt Composer

- Start with an empty prompt.
- Persist the prompt draft across remounts.
- Persist prompt height preferences.
- Support copy prompt, paste prompt, and clear prompt actions.
- Accept another generation while earlier work is still in flight.
- Keep the composer editable during generation.
- Hydrate a prompt and settings handed over from the image inspiration route.
- Do not inject the old default prompt into restored drafts.

## Reference Images

- Support file picker, paste, and drag/drop reference input.
- Number references in upload order.
- Insert the selected numbered reference token into the prompt.
- Remove individual reference images.
- Preserve prompt and reference files across remounts.
- Serialize rapid reference additions so the model limit cannot be bypassed.
- Allow another generation while reference uploads are still in flight.
- Enforce model-specific reference limits before submission.
- Compress and prepare all references before the upstream request.
- Support up to 14 references for models that allow that count.
- Upload all compressed references before URL-based image editing.

## Model-Specific Parameters

- Restore the selected key, model, size settings, quality, format, background,
  count, custom-size state, and prompt height after remount.
- Reset incompatible size and background controls when the model changes.
- Support GPT Image model tiers, aspect ratios, output formats, quality,
  transparency, and custom dimensions.
- Support GIF output only for `gpt-image-2-6`.
- Render animated GIF sources instead of static thumbnails.
- Support Gemini quality tiers, aspect ratios, reference limits, and larger
  local display output.
- Support Grok resolution and aspect controls without quality or transparency.
- Enforce upstream edge and pixel windows:
  - minimum edge `256`
  - maximum edge `3840`
  - minimum pixels `655360`
  - maximum pixels `8294400`
- Converge oversized or undersized presets into the valid pixel window.
- Block custom dimensions outside the pixel budget with a specific explanation.
- Allow Gemini custom display output up to `4096`.
- Show standard 4K dimensions for common aspect ratios.
- Use segmented controls for quality and image count.
- Close size menus on outside click and Escape.

## Generation Count And Slots

- Request one upstream image per pending card.
- Create one stable slot per requested image at submission time.
- Keep every result in its original slot regardless of completion order.
- Show each image as soon as its own task completes.
- Keep a live result aligned with its submission slot during gallery refresh.
- Close gaps in failed or timed-out results unless ordering requires the
  existing restored slot semantics.

## Generation Transport

### Sync path

- Use the synchronous image endpoint when available.
- Enforce a ten-minute overall deadline.
- Surface an explicit timeout failure.
- Display upstream URLs immediately without downloading them locally.
- Avoid local resize when the requested output already matches the user's
  selected size.

### Async path

- Prefer the server-persistent image task path when enabled.
- If persistent execution is unavailable, use the async Gateway endpoint.
- Use an idempotency key for every logical image task.
- Do not fall back to synchronous generation after an ambiguous async
  submission.
- Keep already submitted tasks visible when a later sibling submission loses
  network connectivity.
- Keep waiting beyond 30 seconds for a valid async submission.
- Retry transient submission failures until the overall deadline.
- Retry HTTP `408`, `429`, `502`, `503`, and `504`.
- Retry timed-out status polls until the overall generation deadline.
- Stop polling and mark failure at the overall generation deadline.
- Show an upstream failure immediately without retrying a failed task.
- Treat `preview_ready` as displayable before permanent storage finishes.
- Treat `ready` and `completed` as terminal results.
- Fetch a task by idempotency key after an ambiguous submission.
- Deduplicate ambiguous recovery probes for the same idempotency key.
- Resume a persisted Gateway task with the API key that submitted it.
- Do not process a persistent image result twice.
- Use a completed async image URL directly without downloading and redrawing
  it.
- Show the first completed async image before slower sibling tasks finish.

## Result Cards

- Show a pending placeholder for each in-flight task.
- Show elapsed seconds while generating and remove the timer when finished.
- Render an upstream preview as soon as available.
- Keep the image card usable while local display processing finishes.
- Show explicit media loading and media failure states instead of a blank card.
- Remove loading overlays after the original or preview image loads.
- Fall back to the original image when a thumbnail fails.
- Recover a failed remote thumbnail through the backend thumbnail endpoint.
- Recover a stalled remote thumbnail after the load timeout.
- Mark a media card failed after both thumbnail and original time out.
- Show paused/error states with retry and remove actions.
- Keep failed generations visible and restore them from user history.
- Keep non-upstream protocol failures as removable failure cards.
- Keep generated image ids unique and stable.
- Continue numeric local image ids after restoring a snapshot.

## Result Preview Dialog

- Open a detail dialog for any displayable image.
- Show saved or temporary state.
- Copy the original prompt.
- Edit the prompt in the dialog.
- Regenerate with the same model and size settings.
- Display elapsed generation duration.
- Download the original from the dialog.
- Save a temporary gallery image to permanent works.
- Close from the backdrop.

## Gallery And Quota

- Load saved works on entry.
- Keep rendered gallery URLs stable when only the signed query changes.
- Refresh signed gallery URLs when the page becomes visible again.
- Refresh signed URLs on a six-hour interval while visible.
- Do not let a gallery refresh move an active or restored card.
- Keep gallery images in flat display order.
- Keep a saved image in its original slot after gallery refresh.
- Normalize cached snapshot order when refreshing the page.
- Render gallery images in a uniform grid.
- Render cached gallery immediately when remounting.
- Do not show the same generated image twice when the gallery later lists it.
- Replace a cached generated image with its server gallery identity after
  remount.
- Keep one generated work after remount when signed and gallery URLs differ.
- Load thumbnails through a maximum of four concurrent fallback requests.
- Use a signed direct download URL for gallery images.
- Wait for a newly generated image's gallery id before requesting its direct
  object-storage download URL.
- Fall back to a direct fetch when the signed download URL is unavailable.
- Keep an inline preview as the immediate card source after saving.
- Update a local generated card when its gallery thumbnail URL refreshes.
- Label thumbnail previews and right-click downloads the original.

## Gallery Actions

- Save a generated image to the seven-day gallery.
- Save a temporary gallery image as a permanent work.
- Show the save action again after a saved gallery image is unpinned.
- Pin an image to permanent works.
- Delete a gallery image after a styled confirmation.
- Do not display the image name in delete confirmation.
- Delete with a gallery id rather than a local card id.
- Remove local generated cards when their gallery entry is deleted.

## Persistence

- Persist pending task snapshots per user.
- Persist failed task snapshots per user.
- Persist preferences per user.
- Persist prompt draft and prompt height.
- Persist a compact session snapshot for fast remount.
- Bound inline image data retained in session storage to avoid quota failure.
- Do not persist an in-flight result after the authenticated user changes.
- Restore pending placeholders in original slot order.
- Mark restored pending tasks as timed out after ten minutes.
- Do not restore another user's pending task.
- Do not restore legacy shared pending state into a user-scoped account.
- Resume persistent tasks and ambiguous Gateway submissions after reload.

## Media Display Processing

- Start local display processing only after the first image load is reported.
- Show all completed previews without waiting for another image resize.
- Use an inline preview while the original is only needed on demand.
- Do not run local size processing for a non-custom ratio request.
- Use a display-processing fallback timeout of ten seconds.
- Use a media-load timeout of ten seconds.
- Preserve large original assets for download even when displaying a bounded
  preview.

## Download

- Download the original, not the compressed display source, when available.
- Use a gallery signed download URL when possible.
- Fall back to the backend stream.
- Fall back to direct source fetch.
- Fall back to opening the original source URL.
- Support right-click download menu.
- Show downloading state per image.
- Hand an upstream URL to the server when the browser cannot fetch it.

## Errors And Permissions

- Translate insufficient balance errors to Chinese.
- Distinguish transient network errors from terminal upstream errors.
- Distinguish client timeout and network failure when reporting telemetry.
- Report visible errors once per normalized message.
- Show object-storage configuration errors only to admins.
- Do not show an async fallback warning after a valid `404` response.
- Do not let telemetry failures alter visible generation results.
- Treat gallery storage as optional; generation remains available without it.
- Treat quota failures as non-fatal to the generated result.

## User Isolation And Race Safety

- Ignore stale gallery responses after logout or user switch.
- Ignore stale model responses after user switch.
- Ignore stale snapshot writes after user switch.
- Clear all user-specific maps, timers, selections, failures, pending tasks,
  thumbnail caches, and generation counters on user switch.
- Invalidate gallery thumbnail epochs on user switch.
- Defer gallery refresh while active image work is running.
- Perform one deferred gallery/quota refresh after active work finishes.
- Check owner snapshots after every long-running await before mutating state.

## Current Browser Storage Keys

- `sub2api:image-studio:pending:<userId>`
- `sub2api:image-studio:failures:<userId>`
- `sub2api:image-studio:pending-prompt:<userId>`
- `sub2api:image-studio:preferences[:<userId>]`
- `sub2api:image-studio:snapshot-v1:<userId>`

The refactor must keep migration behavior for these keys, or explicitly
introduce a versioned migration with tests.

## Test Coverage To Preserve

The current `ImageStudioView.spec.ts` has 117 integration tests. They cover:

- composer and model selection;
- key/settings failure tolerance;
- size, quality, format, transparency, and count controls;
- reference upload, ordering, compression, limits, and serialization;
- sync, async, persistent, ambiguous, and resumed generation;
- per-result slots, previews, display processing, and media fallback;
- user isolation and stale response rejection;
- gallery loading, signed URLs, thumbnails, pinning, saving, deleting, and
  quota;
- snapshot, pending, failure, preference, and draft restoration;
- timeout, retry, upstream failure, and telemetry behavior;
- download and detail-dialog behavior.

## Refactor Target Modules

The full refactor should converge on these responsibilities:

- `imageStudioTypes.ts`: shared data contracts.
- `imageTaskState.ts`: task phases and predicates.
- `imageTaskTransport.ts`: response identity, URLs, and task-state mapping.
- `imageTaskClient.ts`: fetch, timeout, retry, submit, poll, lookup, content.
- `imageGenerationQueue.ts`: task creation, slots, owner snapshots, lifecycle.
- `imageStudioGallery.ts`: gallery merge, stable identity, signed assets,
  thumbnails, quota, pin/delete/save.
- `imageStudioPersistence.ts`: versioned user-scoped storage and migration.
- `imageMediaState.ts`: display processing, media load/failure, download.
- `ImageStudioComposer.vue`: prompt, references, model and parameter controls.
- `ImageStudioResults.vue`: result grid and cards.
- `ImageStudioPreviewDialog.vue`: detail and regeneration dialog.
- `ImageStudioView.vue`: orchestration and layout only.
