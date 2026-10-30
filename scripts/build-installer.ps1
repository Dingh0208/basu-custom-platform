param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "1/3 Building frontend..."
& node "node_modules\vite\bin\vite.js" build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

Write-Host "2/3 Building Python sidecar..."
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-sidecar.ps1") -Python $Python
if ($LASTEXITCODE -ne 0) { throw "sidecar build failed" }

Write-Host "3/3 Building NSIS installer..."
npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

Write-Host "Installer output: $root\release"
