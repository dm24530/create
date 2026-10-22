# Infinite Canvas

The platform integrates the original open-source
[`basketikun/infinite-canvas`](https://github.com/basketikun/infinite-canvas)
application as a managed sub-application under `/canvas-app/`.

The source is vendored in `canvas-app/` under the upstream MIT license. Its
original canvas nodes, plugins, prompt library, assets, agent bridge, image and
video generation flows remain available.

## Platform Integration

The Vue application exposes `/canvas`, prepares the current user's platform
creative API key, and loads the React canvas in an iframe.

The iframe loads `/canvas-app/canvas` without credentials in the URL. The Vue
host sends a `create-canvas-bootstrap` message after the iframe loads.
`canvas-app/src/lib/managed-bootstrap.ts` receives credentials from the parent,
fetches the model catalog, assigns image/video defaults and sets managed mode
before React renders.

Managed mode:

- hides the upstream API/channel configuration button
- prevents the config dialog from opening during credential import
- keeps requests on the platform gateway
- preserves the original canvas UI and local-first storage behavior

## Build Order

The Vue build clears `backend/internal/web/dist`, so the canvas sub-application
must be built afterward:

```powershell
pnpm --dir frontend run build
pnpm --dir canvas-app run build
```

The canvas Vite config emits directly to:

```text
backend/internal/web/dist/canvas-app
```

The Go server embeds that directory together with the Vue frontend.

## Development

Run the Vue app on `3000` and the canvas app on `3001`:

```powershell
pnpm --dir frontend run dev
pnpm --dir canvas-app run dev
```

The canvas development server proxies `/api` and `/v1` to the backend on
`8080`. Production uses same-origin assets and API requests.
