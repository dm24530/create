# Create Development Guide

This document describes the current repository, local environment, test
commands, and the boundaries that must be preserved during development.

## Repository

| Item | Value |
| --- | --- |
| Repository | `diminglucky/create` |
| Display name | Create |
| Backend | Go 1.27.2, Gin, Ent, Wire |
| Frontend | Vue 3, Vite, pnpm |
| Database | PostgreSQL |
| Cache | Redis |
| Media | S3-compatible object storage |

The Go module path remains `github.com/Wei-Shaw/sub2api` to preserve upstream
compatibility. Do not rename it without a repository-wide migration.

## Local Requirements

- Go 1.27.2 or newer with `GOTOOLCHAIN=auto`
- Node.js 24
- pnpm 11
- PostgreSQL 16 or newer
- Redis 7 or newer
- Docker 29 or newer when testing the deployment stack

## Backend

```powershell
cd backend
go test -tags=unit ./...
golangci-lint run ./...
go run ./cmd/server
```

Integration tests:

```powershell
go test -tags=integration ./...
```

The integration suite expects PostgreSQL and Redis. Testcontainers may be used
depending on the package.

Ent schema changes:

```powershell
go generate ./ent
go generate ./cmd/server
```

SQL migrations under `backend/migrations` are the schema source of truth.
Applied migrations are checksum-locked and must never be edited.

## Frontend

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:run
pnpm build
```

`pnpm build` writes to `backend/internal/web/dist`, which is embedded by the Go
server when built with `-tags embed`.

The Vite dev server proxies `/api`, `/v1`, and `/setup` to
`VITE_DEV_PROXY_TARGET`, defaulting to `http://localhost:8080`.

## Focused Verification

Image and video studio:

```powershell
cd backend
go test -tags=unit ./internal/service -run 'Test(ImageStudioGallery|VideoStudioGallery|Seedance|VideoInspiration|GrokVideo)'

cd ../frontend
pnpm exec vitest run src/features/image-studio src/features/video-studio src/router/__tests__/customFeatureRoutes.spec.ts
```

Server wiring:

```powershell
cd backend
go test -tags=unit ./internal/server/...
```

## Deployment

The supported stack is:

```bash
cd deploy
docker compose -f docker-compose.create.yml up -d
```

Default port: `9898`.

Required stable secrets:

- `JWT_SECRET`
- `TOTP_ENCRYPTION_KEY`

Required first-run administrator values:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Object storage is required for async image tasks, gallery persistence, and
inspiration media mirroring.

## Upstream Sync

Before syncing upstream, read
[`docs/CUSTOM_FEATURES.md`](docs/CUSTOM_FEATURES.md).

After a sync, run:

```powershell
cd backend
go test -tags=unit ./internal/server/...

cd ../frontend
pnpm typecheck
pnpm exec vitest run src/router/__tests__
```

Custom route and Wire regressions are covered by
`backend/internal/server/custom_feature_wiring_test.go`.

## Compatibility Identifiers

Keep these stable unless a migration is explicitly planned:

- Go module path and import paths.
- Ent package names and generated file layout.
- Redis key prefixes and WebSocket protocol names.
- Plugin manifest fields containing `sub2api_version`.
- Generated Codex/OpenAI provider identifiers used by existing clients.

These identifiers are compatibility contracts even when the visible product
name is Create.

## Common Issues

### pnpm lockfile mismatch

Use pnpm, not npm:

```powershell
cd frontend
pnpm install
```

Commit `pnpm-lock.yaml` whenever dependencies change.

### PowerShell variable expansion in SQL

Do not paste bcrypt hashes into an interpolated PowerShell string. Write the SQL
to a file and run it with `psql -f`.

### Object storage returns 404 for async images

Check the admin object-storage settings and the startup log for missing
credentials. Async image routes return 404 when storage is disabled or
incomplete.

### Frontend builds but the server shows an old UI

Rebuild the Go binary with `-tags embed`, or confirm that
`backend/internal/web/dist` contains the latest frontend build.
