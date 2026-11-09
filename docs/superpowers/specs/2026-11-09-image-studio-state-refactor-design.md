# Image Studio State Refactor Design

## Context

`ImageStudioView.vue` currently owns generation submission, gateway polling,
async task recovery, persisted task recovery, gallery loading, signed asset
URLs, thumbnail loading, download actions, and result rendering in one file.
The page is more than 7,000 lines and represents one generated image with many
overlapping optional flags.

The backend already exposes a task lifecycle including `processing`,
`preview_ready`, `ready`, `completed`, and `failed`. The frontend should consume
that lifecycle through one explicit projection instead of deriving UI behavior
from unrelated booleans.

## Goal

Refactor the image generation area in behavior-preserving stages so that:

- each image has one explicit task phase;
- active generation state and display readiness are derived from that phase;
- result slots remain stable across completion order and gallery refreshes;
- gallery identity and signed URLs cannot reorder active results;
- the page becomes a composition layer rather than the owner of every state.

## Non-Goals

- Do not rewrite upstream image generation, provider failover, billing, or
  object storage.
- Do not change the current visual design in the first stage.
- Do not remove or weaken the existing image studio tests.
- Do not combine unrelated payment, video, or canvas work into this refactor.

## Architecture

The first stage extracts a dependency-free image task model:

`imageStudioTypes.ts`

- Owns `GeneratedImage`, request snapshot, reference, and size types.
- Can be imported by the page, helpers, and tests without importing Vue.

`imageTaskState.ts`

- Owns the public task phase union.
- Projects a generated image into one phase.
- Provides active, terminal, and display-ready predicates.
- Provides stable task and slot identities.

The existing page consumes these helpers at the boundaries where it currently
checks independent flags. Later stages will extract polling and gallery state
into independent composables, but those modules are not required to establish
the first safe boundary.

The full refactor follows the behavior inventory in
`2026-11-09-image-studio-full-refactor-inventory.md`. The page must eventually
become an orchestration layer, with network, persistence, gallery, media, and
presentational responsibilities split into separate modules.

## Task Phases

- `submitted`: request exists locally but has not received a usable task URL.
- `generating`: upstream work is active and no preview is available.
- `preview_ready`: a preview can be rendered while persistence continues.
- `persisted`: the current result is durable in the gallery.
- `failed`: the task is terminal and cannot become successful without retry.
- `uncertain`: submission state cannot currently be confirmed.

Phase precedence is deterministic. Terminal failure wins over pending flags.
A preview wins over a pending background persistence state. A saved terminal
result is `persisted`. A terminal unsaved result remains `preview_ready`.

## Identity And Slots

The stable task identity is, in order:

1. gateway task id;
2. persistent task id;
3. gallery id;
4. local generated image id.

The stable slot identity is the task identity plus the original local slot
index. Gallery refreshes may update mutable fields such as URL, save state, and
expiry, but must not change the slot identity of an active batch.

## Data Flow

```text
submit command
  -> queue entry with stable slot
  -> API transport
  -> task phase transition
  -> result card render
  -> background persistence
  -> gallery identity attachment
```

Gallery events are a side channel. They may update an existing entry or add a
historical entry, but they may not reset an active task phase.

## Testing

- Unit-test the phase projection and identity helpers first.
- Keep the existing `ImageStudioView` integration tests green throughout.
- Verify the page uses phase predicates for active count, generating state, and
  display readiness.
- Verify out-of-order completion and external gallery changes preserve slots.
- Run type checking after each extraction stage.

## Acceptance Criteria

- A single image task has exactly one computed phase.
- The page no longer independently decides active generation from a mixture of
  `generating`, `activeGenerations`, `pending`, and task flags.
- No visual or API contract changes are introduced by the first stage.
- Existing image studio tests and type checking pass.
