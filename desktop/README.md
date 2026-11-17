# Create Desktop

Create Desktop is an Electron shell for the hosted Create web application. It keeps the web app as the single feature surface while taking over login persistence and local download routing.

## Features

- Loads the configured Create website and keeps the login session in a persistent Electron partition.
- Saves image downloads to a configurable image directory.
- Saves video downloads to a configurable video directory.
- Saves archives, audio, and other files to a separate configurable directory.
- Avoids filename collisions and optionally reveals completed files in File Explorer.
- Disables Node.js access from the remote website and exposes only a narrow IPC bridge.
- Uses the fixed hosted server `https://create.superai.sbs` in packaged builds.
- Checks GitHub Releases for desktop-shell updates and installs them after confirmation.

## Development

```powershell
cd desktop
npm install
$env:CREATE_WEB_URL = "http://localhost:9898"
npm start
```

Open `Create -> 本地保存设置…` from the application menu to change the save directories.
The website address is intentionally not configurable in packaged builds; development builds may use
`CREATE_WEB_URL` to target a local server.

## Tests

```powershell
cd desktop
npm run check
```

## Build

```powershell
cd desktop
npm run dist:dir
```

Create an NSIS installer:

```powershell
cd desktop
npm run dist
```

The installer and update metadata are written to `desktop/release/`.

## Publish an update

Increment `version` in `package.json`, then publish a GitHub Release with a `GH_TOKEN` that can write
to `diminglucky/create`:

```powershell
cd desktop
$env:GH_TOKEN = "<github-token>"
npm run release:win
```

Installed versions check for updates at startup and every four hours. The user is prompted to restart
after the update has been downloaded.
