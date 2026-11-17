# Admin UI deployment

The user-facing frontend and the administrator console are separate build artifacts:

- `frontend`: build with `pnpm run build`; output is `backend/internal/web/dist`.
- Admin console: build with `pnpm run build:admin`; output is `backend/internal/web/dist-admin`.

## Required deployment boundary

- Serve the user build from `create.superai.sbs`.
- Serve the admin build from a separate origin such as `admin.create.superai.sbs`.
- Restrict the admin origin with Cloudflare Access, VPN, or an IP allowlist.
- Keep administrator API routes protected by server-side RBAC and a second authentication factor.
- Never copy `dist-admin` into `create-local.exe` or the desktop installer.
- The local Create client blocks `/admin` and `/api/v1/admin/*`.

The Go binary embeds only the user build. The admin build must be deployed as a separate static site
or reverse-proxied from the dedicated admin origin.

- User and admin frontends share domain components but are separate production builds.
- API key changes are streamed through `/api/v1/keys/events` so web, admin-triggered, and local clients refresh immediately.
