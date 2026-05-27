param(
    [switch]$Detach
)

if (-not (Test-Path "./.env")) {
    Copy-Item "./.env.example" "./.env"
    Write-Host "Created .env from .env.example. Update values if needed."
}

if ($Detach) {
    docker compose up -d --build
} else {
    docker compose up --build
}
