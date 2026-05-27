param(
    [string]$EnvPath = "$PSScriptRoot\..\.env"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw ".env file not found: $EnvPath"
}

Get-Content -LiteralPath $EnvPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
        return
    }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) {
        return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$") {
        Set-Item -Path "Env:$name" -Value $value
    }
}

if (-not $env:OPENAI_BASE_URL) {
    $env:OPENAI_BASE_URL = "https://sub2api.luchikey.com/v1"
}

$keyStatus = if ($env:OPENAI_API_KEY) { "loaded" } else { "missing" }
Write-Host "OPENAI_API_KEY: $keyStatus"
Write-Host "OPENAI_BASE_URL: $env:OPENAI_BASE_URL"
