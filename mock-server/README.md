# Create Mock Server

Dependency-free local API used to test the standalone Create app without
PostgreSQL, Redis, S3, or a deployed backend.

```powershell
node server.mjs
```

Default address: `http://127.0.0.1:9890`.

Mock login accepts any email/password. It provides:

- Create auth and refresh;
- one composite image/video API key;
- `/v1/models`;
- in-memory Canvas project CRUD with version checks;
- local Canvas asset registration;
- a basic image generation response.

Run the Web dev server with:

```powershell
$env:VITE_CREATE_API_PROXY_TARGET = "http://127.0.0.1:9890"
npm run dev
```
