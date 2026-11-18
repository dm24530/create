param(
    [int]$MockPort = 9890,
    [int]$WebPort = 3001,
    [string]$BackendUrl = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$mockRoot = Join-Path $root "mock-server"
$webRoot = Join-Path $root "web"
$desktopRoot = Join-Path $root "desktop"
$logRoot = Join-Path $root ".local-run"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Assert-PortFree([int]$Port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use"
    }
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
        }
        Start-Sleep -Milliseconds 300
    }
    throw "Timed out waiting for $Url"
}

function Stop-PortProcess([int]$Port) {
    try {
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    } catch {
    }
}

if (-not $BackendUrl) { Assert-PortFree $MockPort }
Assert-PortFree $WebPort

$mockOut = Join-Path $logRoot "mock.out.log"
$mockErr = Join-Path $logRoot "mock.err.log"
$webOut = Join-Path $logRoot "web.out.log"
$webErr = Join-Path $logRoot "web.err.log"
Remove-Item -LiteralPath $mockOut,$mockErr,$webOut,$webErr -Force -ErrorAction SilentlyContinue

$mockProcess = $null
$webProcess = $null
try {
    $proxyTarget = $BackendUrl.Trim().TrimEnd("/")
    if (-not $proxyTarget) {
        $mockProcess = Start-Process -FilePath "node.exe" -ArgumentList "server.mjs" -WorkingDirectory $mockRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $mockOut -RedirectStandardError $mockErr
        $proxyTarget = "http://127.0.0.1:$MockPort"
    }
    Wait-Http "$proxyTarget/health"

    $env:VITE_CREATE_API_PROXY_TARGET = $proxyTarget
    $webProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$WebPort") -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $webOut -RedirectStandardError $webErr
    Wait-Http "http://127.0.0.1:$WebPort/"

    $env:CREATE_CANVAS_DEV_URL = "http://127.0.0.1:$WebPort"
    $backendKey = if ($BackendUrl) { try { ([Uri]$BackendUrl).Port } catch { "custom" } } else { "mock-$MockPort" }
    $env:CREATE_CANVAS_USER_DATA_PATH = Join-Path $logRoot "user-data-$backendKey"
    Push-Location $desktopRoot
    try {
        & npm.cmd start
    } finally {
        Pop-Location
    }
} finally {
    Stop-PortProcess $WebPort
    if (-not $BackendUrl) {
        Stop-PortProcess $MockPort
    }
    if ($mockProcess -and -not $mockProcess.HasExited) { Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($webProcess -and -not $webProcess.HasExited) { Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item Env:VITE_CREATE_API_PROXY_TARGET -ErrorAction SilentlyContinue
    Remove-Item Env:CREATE_CANVAS_DEV_URL -ErrorAction SilentlyContinue
    Remove-Item Env:CREATE_CANVAS_USER_DATA_PATH -ErrorAction SilentlyContinue
}
