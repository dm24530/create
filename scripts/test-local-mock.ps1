param(
    [int]$MockPort = 9890,
    [int]$WebPort = 3003,
    [string]$Test = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mockRoot = Join-Path $root "mock-server"
$webRoot = Join-Path $root "web"
$desktopRoot = Join-Path $root "desktop"
$logRoot = Join-Path $root ".local-run-full"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Assert-PortFree([int]$Port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use"
    }
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {}
        Start-Sleep -Milliseconds 300
    }
    throw "Timed out waiting for $Url"
}

function Stop-OwnedProcess($Process) {
    if (-not $Process) { return }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
    } catch {}
}

Assert-PortFree $MockPort
Assert-PortFree $WebPort

$mockOut = Join-Path $logRoot "mock.out.log"
$mockErr = Join-Path $logRoot "mock.err.log"
$webOut = Join-Path $logRoot "web.out.log"
$webErr = Join-Path $logRoot "web.err.log"
$mockProcess = $null
$webProcess = $null

try {
    $env:CREATE_MOCK_PORT = "$MockPort"
    try {
        $mockProcess = Start-Process -FilePath "node" -ArgumentList "server.mjs" -WorkingDirectory $mockRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $mockOut -RedirectStandardError $mockErr
    } finally {
        Remove-Item Env:CREATE_MOCK_PORT -ErrorAction SilentlyContinue
    }
    Wait-Http "http://127.0.0.1:$MockPort/health"

    $env:VITE_CREATE_API_PROXY_TARGET = "http://127.0.0.1:$MockPort"
    try {
        $webProcess = Start-Process -FilePath "node" -ArgumentList @("node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "$WebPort", "--strictPort") -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $webOut -RedirectStandardError $webErr
    } finally {
        Remove-Item Env:VITE_CREATE_API_PROXY_TARGET -ErrorAction SilentlyContinue
    }
    Wait-Http "http://127.0.0.1:$WebPort/"

    $env:CREATE_CANVAS_DEV_URL = "http://127.0.0.1:$WebPort"
    $env:CREATE_CANVAS_MOCK_URL = "http://127.0.0.1:$MockPort"
    Push-Location $desktopRoot
    try {
        $tests = @(
            "test/mock-login-smoke.js",
            "test/mock-account-smoke.js",
            "test/mock-image-generation-smoke.js",
            "test/mock-video-generation-smoke.js",
            "test/mock-canvas-generation-smoke.js",
            "test/mock-product-detail-smoke.js",
            "test/mock-navigation-smoke.js",
            "test/mock-video-31-capabilities-smoke.js",
            "test/mock-video-reference-media-smoke.js",
            "test/mock-video-mode-matrix-smoke.js"
        )
        if ($Test) {
            $tests = @($tests | Where-Object { $_ -like "*$Test*" })
            if (-not $tests.Count) { throw "No mock test matched: $Test" }
        }
        foreach ($test in $tests) {
            Write-Host "Running $test"
            & node $test
            if ($LASTEXITCODE -ne 0) { throw "$test failed with exit code $LASTEXITCODE" }
        }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:CREATE_CANVAS_DEV_URL -ErrorAction SilentlyContinue
    Remove-Item Env:CREATE_CANVAS_MOCK_URL -ErrorAction SilentlyContinue
    Stop-OwnedProcess $webProcess
    Stop-OwnedProcess $mockProcess
}
