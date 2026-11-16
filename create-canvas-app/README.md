# Create Canvas Standalone App

Independent Create application built from the pinned
[`basketikun/infinite-canvas`](https://github.com/basketikun/infinite-canvas) UI.

This source tree is intentionally separate from the existing Vue Web and
`canvas-app/`. The upstream MIT license is retained at
`../LICENSE.infinite-canvas`.

## Current Implementation

- Upstream React UI and infinite canvas remain the product surface.
- Login uses the existing Create `/api/v1/auth/login` and refresh flow.
- A managed Create API key is reused or created automatically.
- Image and video models are loaded from the Create `/v1/models` gateway.
- Canvas projects and assets use the existing `/api/v1/canvas` API.
- Browser storage remains IndexedDB/localForage for this milestone.
- Electron loads bundled local assets from `app://create/`.
- The existing Vue Web remains unchanged.

## Web Development

```powershell
cd create-canvas-app/web
npm install --legacy-peer-deps
npm run dev
```

The Vite development server proxies `/api` and `/v1` to
`http://127.0.0.1:8080`. Override with `VITE_CREATE_API_PROXY_TARGET`.

## Web Build

```powershell
npm run build
```

Output: `create-canvas-app/web/dist`.

## Desktop Build

```powershell
cd create-canvas-app/web
npm run build:desktop

cd ../desktop
npm install --legacy-peer-deps
npm start
```

`build:desktop` reads `.env.desktop` and points API traffic to
`https://create.superai.sbs`. The desktop app uses a separate `app://create`
origin.

The server CORS policy must allow the desktop origin:

```yaml
cors:
  allowed_origins:
    - https://create.superai.sbs
    - app://create
  allow_credentials: true
```

## Desktop Tests

```powershell
cd create-canvas-app/desktop
npm run check
npm run test:smoke
```

`test:smoke` launches Electron against `web/dist-desktop` and verifies that the
Create login screen renders through the `app://create` protocol.

## Known Limitations

- Two-factor login is not implemented in the standalone gate yet.
- Desktop refresh-token storage currently uses the persistent Electron profile,
  not Windows DPAPI or macOS Keychain.
- The first milestone intentionally keeps upstream UI and IndexedDB persistence.
- Real account login and generation require the configured Create server and
  database-backed test credentials.

