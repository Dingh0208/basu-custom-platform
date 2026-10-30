param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "1/4 Building frontend..."
& node "node_modules\vite\bin\vite.js" build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

Write-Host "2/4 Building Python sidecar..."
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-sidecar.ps1") -Python $Python
if ($LASTEXITCODE -ne 0) { throw "sidecar build failed" }

Write-Host "3/4 Packaging Electron win-unpacked..."
& npx electron-builder --win dir
if ($LASTEXITCODE -ne 0) { throw "electron-builder dir packaging failed" }

Write-Host "4/4 Building selectable-path NSIS installer..."
$nsisDir = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\nsis" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $nsisDir) { throw "NSIS cache not found; run electron-builder once first" }
$makensis = Join-Path $nsisDir.FullName "Bin\makensis.exe"
$installer = Join-Path $root "release\ClientHub Setup 0.1.0.exe"
& $makensis "/DAPP_DIR=$root\release\win-unpacked" "/DOUT_FILE=$installer" "/V2" (Join-Path $PSScriptRoot "installer.nsi")
if ($LASTEXITCODE -ne 0) { throw "NSIS installer build failed" }

Write-Host "Installer output: $installer"
