# Muse video seed

The deployment image contains the Muse video implementation (`muse-video`,
`muse-cheap`, text-to-video, image-to-video and reference images). PostgreSQL
data and real provider keys are intentionally not baked into the image.

Run one of these commands after the stack is healthy:

```powershell
.\deploy\muse\apply.ps1
```

```sh
./deploy/muse/apply.sh
```

The scripts create or update:

- account `muse` with platform `muse`
- group `Muse 视频`
- account-group routing
- model allowlist for `muse-video` and `muse-cheap`

The API key is read interactively by default. It is stored only in PostgreSQL.
The seed leaves video pricing empty on first creation, so the built-in Muse
billing defaults apply. Re-running the seed does not overwrite prices changed
in the admin UI.
To override the upstream URL:

```powershell
.\deploy\muse\apply.ps1 -BaseUrl "https://momoapi.xin/v1"
```

```sh
MUSE_BASE_URL="https://momoapi.xin/v1" ./deploy/muse/apply.sh
```

This seed does not copy users, API keys issued by Create, usage history, payments
or uploaded files. For a full migration of those tables, restore the old
PostgreSQL database instead.
