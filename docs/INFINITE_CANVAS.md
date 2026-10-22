# Infinite Canvas

The infinite canvas is a Vue-native workspace for composing image and video
generation nodes on a persistent server-side project.

## Scope

- `/canvas` lists the current user's projects.
- `/canvas/:projectId` opens a Vue Flow workspace.
- Image and video nodes submit through the existing gateway and creative key.
- The canvas header can select any active image-capable key; it initially uses
  the image studio's last selected key and shares that preference.
- Generated outputs are archived through the existing image/video studio
  gallery services so R2 URLs remain durable.
- The graph, viewport and node task metadata are stored in PostgreSQL.

## Persistence

`canvas_projects` stores one JSONB graph per project:

```text
id, user_id, title, graph, version, created_at, updated_at
```

`graph` contains Vue Flow nodes, edges and viewport. The integer `version`
implements optimistic locking. Every update uses the version previously read by
the client and returns `409` when another tab saved first.

Generated media is not embedded in JSONB. Nodes keep the durable gallery URL
returned after the generated file is archived in object storage.

## Generation Flow

Image nodes:

1. Submit to `/images/generations/async` or `/images/edits/async`.
2. Store the returned task ID and poll URL on the node.
3. Poll `/images/tasks/:id` until completion.
4. Archive the result in the image studio gallery.
5. Save the returned durable URL in the node.

Video nodes reuse the existing Seedance/Grok task helpers:

1. Create the upstream task.
2. Persist provider and task ID on the node.
3. Poll using the existing video task client.
4. Archive the finished video in the video studio gallery.
5. Save the durable archive URL in the node.

All model requests continue to use the user's creative API key and the existing
gateway, so routing, group permissions, model pricing and usage billing are not
duplicated.

## Current MVP Boundaries

- Text-to-image and text-to-video are supported.
- Connected upstream image nodes are sent as image references for image edits
  where the protocol supports them.
- A connected image is sent as the first frame/reference for video generation.
- The canvas has not yet added grouping, export, multi-tab presence or a custom
  canvas asset lifecycle. Generated files use the existing studio works quota.
