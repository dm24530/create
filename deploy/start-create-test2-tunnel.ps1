param(
  [string]$TokenFile = "$env:USERPROFILE\.cloudflared\create-test2-local.token",
  [int]$MetricsPort = 20246
)

$ErrorActionPreference = "Stop"

$cloudflared = Join-Path $env:LOCALAPPDATA "cloudflared\cloudflared.exe"
if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "cloudflared not found: $cloudflared"
}
if (-not (Test-Path -LiteralPath $TokenFile)) {
  throw "tunnel token not found: $TokenFile"
}

$existing = Get-CimInstance Win32_Process -Filter "name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -like "*$TokenFile*" }
foreach ($process in $existing) {
  if ($process.CommandLine -match "--protocol\s+http2") {
    exit 0
  }
  Stop-Process -Id $process.ProcessId -Force
}

$logDir = Join-Path $PSScriptRoot "create-test2-tunnel"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Process `
  -FilePath $cloudflared `
  -ArgumentList @(
    "tunnel",
    "--protocol", "http2",
    "--no-autoupdate",
    "--metrics", "127.0.0.1:$MetricsPort",
    "run",
    "--token-file", $TokenFile
  ) `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "cloudflared.out.log") `
  -RedirectStandardError (Join-Path $logDir "cloudflared.err.log")
