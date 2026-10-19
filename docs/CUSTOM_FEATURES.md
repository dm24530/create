# Create Custom Features

This repository is a customized Create distribution built on Sub2API. The
features below are owned by this repository and must survive upstream merges.

## Product Modules

### Image Studio

- Frontend: `frontend/src/features/image-studio`
- User API: `/api/v1/image-studio/gallery`
- Generation routes: `/v1/images/generations`, `/v1/images/edits`
- Async routes: `/v1/images/generations/async`, `/v1/images/tasks/:id`
- Services: `image_task.go`, `image_studio_gallery.go`,
  `image_storage.go`, `image_storage_settings.go`

### Video Studio

- Frontend: `frontend/src/features/video-studio`
- User API: `/api/v1/video-studio/gallery`
- Inspiration API: `/api/v1/video-inspiration/*`
- Grok routes: `/v1/videos/*`
- Seedance routes: `/api/v3/contents/generations/tasks`
- Services: `grok_media.go`, `seedance.go`, `video_billing.go`,
  `video_studio_gallery.go`, `video_inspiration.go`,
  `inspiration_library.go`

### Works Library

- Shared table: `studio_works`
- Supported kinds: `image`, `video`
- Saved works are permanent and count against the configured quota.
- Temporary works expire and are swept together with their storage objects.
- Quota and retention are controlled from admin object-storage settings.

## Frontend Entry Points

- `frontend/src/router/customFeatureRoutes.ts`
  - `/playground`
  - `/image-studio`
  - `/video-studio`
  - `/video-inspiration`
  - `/video-works`
  - `/lottery`
  - `/manual`
  - `/models`
- `frontend/src/components/layout/customFeatureNav.ts`
- `frontend/src/components/layout/AppSidebar.vue`

## Backend Entry Points

- `backend/internal/server/router.go`
- `backend/internal/server/routes/user.go`
- `backend/internal/server/routes/admin.go`
- `backend/internal/server/routes/custom_features.go`
- `backend/internal/server/routes/gateway.go`
- `backend/internal/service/wire.go`
- `backend/internal/repository/wire.go`
- `backend/internal/handler/wire.go`

Custom services must be registered through provider sets. Never hand-edit
`backend/cmd/server/wire_gen.go`.

## Upstream Sync Rules

1. Do not accept upstream deletions of files listed here without porting the
   feature into the new upstream structure.
2. Preserve custom route registration and Wire provider-set entries.
3. Preserve `studio_works`, image storage, and video task migrations.
4. Keep API paths stable unless frontend, backend, and deployment docs change
   together.
5. Keep internal compatibility identifiers such as the Go module path, Redis
   keys, plugin fields, and generated client provider IDs.

After every upstream sync, run:

```powershell
cd backend
go test -tags=unit ./internal/server/...

cd ../frontend
pnpm typecheck
pnpm exec vitest run src/router/__tests__ src/features/image-studio src/features/video-studio
```

## Regression Guards

- `backend/internal/server/custom_feature_wiring_test.go` checks critical route
  and dependency-injection wiring at source level.
- `frontend/src/router/__tests__/customFeatureRoutes.spec.ts` checks the custom
  routes remain registered.
- Image, video, Seedance, and gallery tests live beside their services.

## Internal Compatibility Identifiers

The following names intentionally remain unchanged:

- Go module path: `github.com/Wei-Shaw/sub2api`
- Plugin manifest fields containing `sub2api_version`
- Redis and browser storage keys beginning with `sub2api`
- Ops WebSocket protocol name `sub2api-admin`
- Existing plugin package names and compatibility checks

These are data or protocol contracts. Visible branding and public documentation
must use Create.
