param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "release\ai-sidecar"
$workDir = Join-Path $root "build\ai-sidecar"
$specDir = Join-Path $root "build\ai-sidecar-spec"

Write-Host "Checking PyInstaller..."
& $Python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller not installed. Run: $Python -m pip install pyinstaller"
}

New-Item -ItemType Directory -Force -Path $outDir, $workDir, $specDir | Out-Null
$entry = Join-Path $root "services\ai\main.py"
& $Python -m PyInstaller --noconfirm --clean --onefile --name clienthub-ai `
  --distpath $outDir --workpath $workDir --specpath $specDir $entry

Write-Host "Built: $outDir\clienthub-ai.exe"
