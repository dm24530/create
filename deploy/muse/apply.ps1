param(
    [string]$Container = "create-postgres",
    [string]$Database = "create",
    [string]$User = "create",
    [string]$BaseUrl = "https://momoapi.xin/v1",
    [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"

if (-not $ApiKey) {
    $secure = Read-Host "Muse API key" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

if (-not $ApiKey) {
    throw "Muse API key is required"
}

$seedPath = Join-Path $PSScriptRoot "seed.sql"
if (-not (Test-Path -LiteralPath $seedPath -PathType Leaf)) {
    throw "seed.sql not found: $seedPath"
}

$containerSeedPath = "/tmp/create-muse-seed.sql"
docker cp $seedPath "${Container}:$containerSeedPath"
if ($LASTEXITCODE -ne 0) {
    throw "failed to copy seed.sql into $Container"
}

docker exec $Container psql `
    -U $User `
    -d $Database `
    -v "ON_ERROR_STOP=1" `
    -v "muse_api_key=$ApiKey" `
    -v "muse_base_url=$BaseUrl" `
    -f $containerSeedPath
if ($LASTEXITCODE -ne 0) {
    throw "Muse seed failed"
}

docker exec $Container rm -f $containerSeedPath
