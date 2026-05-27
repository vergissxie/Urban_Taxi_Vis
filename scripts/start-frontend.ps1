param(
    [int]$Port = 5173,
    [string]$BindHost = "localhost"
)

Set-Location "$PSScriptRoot\..\frontend"
npm.cmd run dev -- --host $BindHost --port $Port
