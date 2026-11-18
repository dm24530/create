# Legacy desktop clients

These directories are archived for reference only.

- `desktop/`: the old Electron shell that loaded the hosted cloud website.
- `local-client/`: the earlier Go-based local launcher.

The active product is the standalone Electron app in `desktop/` and its bundled
UI in `web/`. New builds and releases use `.github/workflows/create-canvas-app.yml`.
