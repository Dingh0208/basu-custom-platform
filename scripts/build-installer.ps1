param(
  [string]$Python = "python",
  [ValidateSet("nsis", "nsis-web", "all")]
  [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "1/5 Generating application icons..."
& $Python scripts/generate-icon.py
if ($LASTEXITCODE -ne 0) { throw "icon generation failed" }

Write-Host "2/5 Building optional WeChat component..."
& $Python scripts/build-wechat-component.py
if ($LASTEXITCODE -ne 0) { throw "WeChat component build failed" }

Write-Host "3/5 Building frontend..."
& npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

Write-Host "4/5 Building Python sidecar..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-sidecar.ps1") -Python $Python
if ($LASTEXITCODE -ne 0) { throw "sidecar build failed" }

Write-Host "5/5 Building $Target installer..."
if ($Target -eq "all") {
  & npx electron-builder --win nsis-web --x64 --publish never
  if ($LASTEXITCODE -ne 0) { throw "Web installer packaging failed" }
  # Write offline metadata last: existing offline installations retain their
  # cached-installer differential path instead of switching update formats.
  & npx electron-builder --win nsis --x64 --prepackaged release/win-unpacked --publish never
} else {
  & npx electron-builder --win $Target --x64 --publish never
}
if ($LASTEXITCODE -ne 0) { throw "electron-builder $Target packaging failed" }

Write-Host "Installer output is in $root\release"
