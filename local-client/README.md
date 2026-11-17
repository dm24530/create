# Create Local

Create Local is a loopback-only Go client for the hosted Create platform.

## Runtime model

```text
Browser -> http://127.0.0.1:<random-port> -> Create Local
Create Local -> https://create.superai.sbs -> image/video model APIs
```

- User-facing workbenches and Canvas are served from the local process.
- Auth, balance, quota, announcements, and model APIs are proxied to Create Cloud.
- `/admin` and `/api/v1/admin/*` are blocked locally.
- Images, videos, archives, and other downloads are written to configured local directories.
- Image/video gallery entries and Canvas project metadata are stored in the local data directory.
- Remote gallery and Canvas project write endpoints are not used by the local client.
- Local state is stored under `%APPDATA%\CreateLocal`.

The local process is not a copy of the server backend and does not contain a database server,
Redis, payment configuration, upstream account credentials, or the admin console.

## Build

```powershell
cd local-client
.\build.ps1 -BuildFrontend
```

The executable is written to `local-client/dist/create-local.exe`.

The remote server remains responsible only for authentication, API keys, billing, quota,
announcements, payment, and model relay.
