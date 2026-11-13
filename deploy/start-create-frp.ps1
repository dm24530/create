param(
  [string]$InstallDir = "$env:LOCALAPPDATA\create-frp"
)

$ErrorActionPreference = "Stop"

$frpc = Join-Path $InstallDir "frpc.exe"
$config = Join-Path $InstallDir "frpc.toml"
$stdoutLog = Join-Path $InstallDir "frpc.out.log"
$stderrLog = Join-Path $InstallDir "frpc.err.log"

if (-not (Test-Path -LiteralPath $frpc)) {
  throw "frpc not found: $frpc"
}
if (-not (Test-Path -LiteralPath $config)) {
  throw "frpc config not found: $config"
}

$existing = Get-CimInstance Win32_Process -Filter "name='frpc.exe'" |
  Where-Object { $_.CommandLine -like "*$config*" }
if ($existing) {
  exit 0
}

Start-Process `
  -FilePath $frpc `
  -ArgumentList @("-c", $config) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog
