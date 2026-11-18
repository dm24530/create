param(
  [switch]$BuildFrontend
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot "frontend"
$distSource = Join-Path $repoRoot "backend/internal/web/dist"
$distTarget = Join-Path $PSScriptRoot "internal/webassets/dist"
$outputDir = Join-Path $PSScriptRoot "dist"
$version = (Get-Content -Raw (Join-Path $PSScriptRoot "VERSION")).Trim()
$localRootFull = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd("\") + "\"
$distTargetFull = [IO.Path]::GetFullPath($distTarget)
if (-not $distTargetFull.StartsWith($localRootFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw "dist target escapes local-client directory: $distTargetFull"
}

if ($BuildFrontend) {
  Push-Location $frontendRoot
  try {
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $distSource "index.html"))) {
  throw "frontend dist is missing; run with -BuildFrontend"
}

if (Test-Path -LiteralPath $distTarget) {
  Get-ChildItem -LiteralPath $distTarget -Force | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $distTarget | Out-Null
Copy-Item -Path (Join-Path $distSource "*") -Destination $distTarget -Recurse -Force
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location $PSScriptRoot
try {
  go test ./...
  if ($LASTEXITCODE -ne 0) { throw "local client tests failed" }
  go build -trimpath -ldflags="-s -w -X main.Version=$version" -o (Join-Path $outputDir "create-local.exe") ./cmd/create-local
  if ($LASTEXITCODE -ne 0) { throw "local client build failed" }
} finally {
  Pop-Location
}

$readmeTarget = Join-Path $outputDir "README.txt"
@"
Create Local $version
=====================

Run create-local.exe. A browser will open automatically.

Data directory: %APPDATA%\CreateLocal
Remote server:  https://create.superai.sbs
"@ | Set-Content -LiteralPath $readmeTarget -Encoding UTF8

$archivePath = Join-Path $outputDir "Create-Local-$version.zip"
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $outputDir "create-local.exe"), $readmeTarget -DestinationPath $archivePath

$hashFile = Join-Path $outputDir "create-local.exe.sha256"
$hash = (Get-FileHash -LiteralPath (Join-Path $outputDir "create-local.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  create-local.exe" | Set-Content -LiteralPath $hashFile -Encoding ASCII
$manifestFile = Join-Path $outputDir "latest.json"
@{
  version = $version
  notes = "Create Local $version"
  exe_url = "/api/v1/public/local-client/create-local.exe"
  sha256_url = "/api/v1/public/local-client/create-local.exe.sha256"
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestFile -Encoding UTF8

Write-Host "Built: $(Join-Path $outputDir 'create-local.exe')"
Write-Host "Archive: $archivePath"
Write-Host "SHA256:  $hashFile"
Write-Host "Manifest: $manifestFile"
