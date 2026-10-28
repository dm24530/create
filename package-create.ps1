param(
  [string]$Tag = "create:20261028-video-reference-isolation",
  [string]$PackageName = "create-update-20261028-video-reference-isolation"
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$releaseDir = Join-Path $repoRoot "release"
$stageName = "package-$PackageName"
$stageDir = Join-Path $releaseDir $stageName
$imageArchiveName = (($Tag -replace '[^A-Za-z0-9._-]', '-') + '.tar')
$imageTar = Join-Path $stageDir $imageArchiveName
$archivePath = Join-Path $releaseDir "$PackageName.tar.gz"
$checksumPath = "$archivePath.sha256"

function Get-SourceFingerprint {
  param([string]$Root)

  $paths = @(
    "Dockerfile",
    ".dockerignore",
    "backend",
    "frontend/src",
    "frontend/public",
    "frontend/package.json",
    "frontend/pnpm-lock.yaml",
    "canvas-app/src",
    "canvas-app/public",
    "canvas-app/package.json",
    "canvas-app/pnpm-lock.yaml",
    "docs/legal",
    "deploy/docker-compose.create.yml",
    "deploy/docker-entrypoint.sh",
    "release/create-update/update-server.sh"
  )

  $files = foreach ($path in $paths) {
    $full = Join-Path $Root $path
    if (Test-Path -LiteralPath $full -PathType Leaf) {
      Get-Item -LiteralPath $full
    } elseif (Test-Path -LiteralPath $full -PathType Container) {
      Get-ChildItem -LiteralPath $full -Recurse -File
    }
  }

  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd("\")
  $lines = $files |
    Where-Object {
      $_.FullName -notmatch '\\node_modules\\|\\bin\\|\\dist\\|\\release\\'
    } |
    ForEach-Object {
      $relative = $_.FullName.Substring($rootFull.Length).TrimStart("\").Replace("\", "/")
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
      "$relative`0$hash"
    } |
    Sort-Object

  $joined = $lines -join "`n"
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($joined)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Copy-SourceSnapshot {
  param([string]$Root, [string]$Destination)

  $paths = @(
    "Dockerfile",
    ".dockerignore",
    "backend",
    "frontend",
    "canvas-app",
    "docs/legal",
    "deploy/docker-entrypoint.sh"
  )

  foreach ($path in $paths) {
    $source = Join-Path $Root $path
    if (-not (Test-Path -LiteralPath $source)) {
      throw "source path missing: $source"
    }

    if (Test-Path -LiteralPath $source -PathType Leaf) {
      $target = Join-Path $Destination $path
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Force
      continue
    }

    Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object {
      $_.FullName -notmatch '\\node_modules\\|\\backend\\bin\\|\\backend\\internal\\web\\dist\\|\\frontend\\dist\\|\\canvas-app\\dist\\'
    } | ForEach-Object {
      $relative = $_.FullName.Substring($Root.Length).TrimStart("\")
      $target = Join-Path $Destination $relative
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

$fingerprintBefore = Get-SourceFingerprint -Root $repoRoot

$releaseRootFull = [IO.Path]::GetFullPath($releaseDir).TrimEnd("\") + "\"
$stageDirFull = [IO.Path]::GetFullPath($stageDir)
if (-not $stageDirFull.StartsWith($releaseRootFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw "staging directory escapes release directory: $stageDirFull"
}
if (Test-Path -LiteralPath $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
$snapshotRoot = Join-Path $releaseDir ("source-snapshot-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $snapshotRoot | Out-Null
Copy-SourceSnapshot -Root $repoRoot -Destination $snapshotRoot

$fingerprintSnapshot = Get-SourceFingerprint -Root $repoRoot
if ($fingerprintBefore -ne $fingerprintSnapshot) {
  throw "source tree changed while taking the snapshot; retry packaging after the current edit finishes"
}

$commit = (git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "git revision lookup failed" }

docker build `
  --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:24-alpine `
  --build-arg GOLANG_IMAGE=docker.m.daocloud.io/library/golang:1.27.2-alpine `
  --build-arg ALPINE_IMAGE=docker.m.daocloud.io/library/alpine:3.21 `
  --build-arg POSTGRES_IMAGE=docker.m.daocloud.io/library/postgres:18-alpine `
  --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com `
  --build-arg GOPROXY=https://goproxy.cn,direct `
  --build-arg GOSUMDB=sum.golang.google.cn `
  --build-arg COMMIT=$commit `
  -t $Tag `
  -t create:latest `
  -f (Join-Path $snapshotRoot "Dockerfile") `
  $snapshotRoot
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

docker save -o $imageTar $Tag
if ($LASTEXITCODE -ne 0) { throw "docker save failed" }

Push-Location (Join-Path $snapshotRoot "backend")
try {
  $env:CGO_ENABLED = "0"
  $env:GOOS = "linux"
  $env:GOARCH = "amd64"
  go build -trimpath -o (Join-Path $stageDir "storage-key-migrate-linux-amd64") ./cmd/storage-key-migrate
  if ($LASTEXITCODE -ne 0) { throw "storage-key-migrate build failed" }
} finally {
  Pop-Location
}

Copy-Item -Force (Join-Path $repoRoot "deploy/docker-compose.create.yml") $stageDir

$updateScript = Get-Content -Raw (Join-Path $repoRoot "release/create-update/update-server.sh")
$updateScript = $updateScript -replace '(?m)^TARGET_IMAGE=.*$', ('TARGET_IMAGE="${TARGET_IMAGE:-' + $Tag + '}"')
$updateScript = $updateScript -replace '(?m)^IMAGE_TAR=.*$', ('IMAGE_TAR="${IMAGE_TAR:-${SCRIPT_DIR}/' + $imageArchiveName + '}"')
Set-Content -LiteralPath (Join-Path $stageDir "update-server.sh") -Value $updateScript -Encoding utf8NoBOM

$readme = @"
Create update package
=====================

Contents:
- $imageArchiveName
- storage-key-migrate-linux-amd64
- docker-compose.create.yml
- update-server.sh

Run on the server from any directory:

  bash update-server.sh

Optional overrides:

  DEPLOY_DIR=/opt/create COMPOSE_FILE=docker-compose.create.yml bash update-server.sh

Target image:

  $Tag

The script:
1. saves the current image name and .env
2. backs up PostgreSQL
3. loads the new image
4. updates IMAGE in .env
5. recreates only the create container
6. checks container and host health
7. restores the previous image and .env automatically if health fails

It does not delete PostgreSQL, Redis, application data, or R2 objects.
"@
Set-Content -LiteralPath (Join-Path $stageDir "README.txt") -Value $readme -Encoding utf8NoBOM

foreach ($required in @("update-server.sh", "README.txt")) {
  $path = Join-Path $stageDir $required
  if (-not (Test-Path -LiteralPath $path)) {
    throw "missing packaging file: $path"
  }
}

tar -czf $archivePath -C $releaseDir $stageName
if ($LASTEXITCODE -ne 0) { throw "archive creation failed" }

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
"$hash  $([IO.Path]::GetFileName($archivePath))" |
  Set-Content -LiteralPath $checksumPath -Encoding ascii

Write-Host ""
Write-Host "Package:     $archivePath"
Write-Host "Checksum:    $checksumPath"
Write-Host "SHA256:      $hash"
Write-Host "Source:      $fingerprintSnapshot"
Write-Host "Snapshot:    $snapshotRoot"
