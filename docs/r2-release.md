# R2 App Release Publishing

The desktop release workflow uploads installers and update manifests to a dedicated Cloudflare R2 bucket. It does not publish installer files to GitHub Releases or GitHub Pages.

## Required R2 setup

1. Create a **new R2 bucket** dedicated to app downloads. Do not reuse the existing image/backup bucket.
2. Bind the custom domain `download.superai.sbs` to that new bucket in the R2 bucket settings.
3. Create an R2 API token with Object Read & Write permission limited to the new bucket.
4. Add these GitHub repository Actions secrets:
   - `R2_ACCOUNT_ID`
   - `R2_BUCKET` — the new bucket name
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`

The workflow fails closed when any secret is missing.

## Object layout

```text
app-releases/latest.yml
app-releases/windows/x64/latest.yml
app-releases/windows/arm64/latest.yml
app-releases/macos/arm64/latest-mac.yml
app-releases/macos/x64/latest-mac.yml
app-releases/v<version>/<installer files>
```

The app updater base URL is:

```text
https://download.superai.sbs/app-releases
```

The download page should use the versioned direct links:

```text
https://download.superai.sbs/app-releases/v<version>/Create-Setup-<version>-win-x64.exe
https://download.superai.sbs/app-releases/v<version>/Create-Setup-<version>-win-arm64.exe
https://download.superai.sbs/app-releases/v<version>/Create-<version>-mac-arm64.dmg
https://download.superai.sbs/app-releases/v<version>/Create-<version>-mac-x64.dmg
```

## Verification

After a tagged build:

```bash
curl -I https://download.superai.sbs/app-releases/windows/x64/latest.yml
curl -I https://download.superai.sbs/app-releases/v<version>/Create-Setup-<version>-win-x64.exe
```

If the custom domain has not propagated yet, configure DNS in Cloudflare and wait for the certificate to become active before publishing the release metadata.
