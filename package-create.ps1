param(
  [string]$Tag = "create:20261027-e2aaf705-r2fix-v2",
  [string]$PackageName = "create-update-20261027-e2aaf705-r2fix-v2"
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$releaseDir = Join-Path $repoRoot "release"
$stageName = "create-update-v2"
$stageDir = Join-Path $releaseDir $stageName
$imageTar = Join-Path $stageDir "create-20261027-e2aaf705-r2fix-v2.tar"
$archivePath = Join-Path $releaseDir "$PackageName.tar.gz"
$checksumPath = "$archivePath.sha256"

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

docker build `
  --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:24-alpine `
  --build-arg GOLANG_IMAGE=docker.m.daocloud.io/library/golang:1.27.2-alpine `
  --build-arg ALPINE_IMAGE=docker.m.daocloud.io/library/alpine:3.21 `
  --build-arg POSTGRES_IMAGE=docker.m.daocloud.io/library/postgres:18-alpine `
  --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com `
  --build-arg GOPROXY=https://goproxy.cn,direct `
  --build-arg GOSUMDB=sum.golang.google.cn `
  -t $Tag `
  -t create:latest `
  -f (Join-Path $repoRoot "Dockerfile") `
  $repoRoot
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

docker save -o $imageTar $Tag
if ($LASTEXITCODE -ne 0) { throw "docker save failed" }

Push-Location (Join-Path $repoRoot "backend")
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
Copy-Item -Force (Join-Path $repoRoot "release/create-update/update-server.sh") $stageDir
Copy-Item -Force (Join-Path $repoRoot "release/create-update/README.txt") $stageDir

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
Write-Host "Package:  $archivePath"
Write-Host "Checksum: $checksumPath"
Write-Host "SHA256:   $hash"
