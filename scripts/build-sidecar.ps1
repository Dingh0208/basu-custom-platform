param(
  [string]$Python = "python",
  [switch]$IncludeEnv
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root "release\ai-sidecar"
$outDir = Join-Path $distDir "clienthub-ai"
$workDir = Join-Path $root "build\ai-sidecar"
$specDir = Join-Path $root "build\ai-sidecar-spec"

Write-Host "Checking PyInstaller..."
& $Python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller not installed. Run: $Python -m pip install pyinstaller"
}

New-Item -ItemType Directory -Force -Path $outDir, $workDir, $specDir | Out-Null
& $Python -c "import pypdf, docx, openpyxl, pptx, xlrd, olefile, pypdfium2, rapidocr_onnxruntime, onnxruntime"
if ($LASTEXITCODE -ne 0) {
  throw "Document parsers not installed. Run: $Python -m pip install -r services/ai/requirements.txt"
}
$entry = Join-Path $root "services\ai\main.py"
# Prefer the installed VC++ runtime over older copies on PATH (for example Java).
# Mixing those DLLs can crash ONNX Runtime even when source-mode OCR works.
$buildOriginalPath = $env:PATH
try {
  $env:PATH = "$env:SystemRoot\System32;$buildOriginalPath"
  # Let NSIS compress the dependencies individually. A one-file executable
  # recompresses them on every build, reducing cross-version block reuse.
  & $Python -m PyInstaller --noconfirm --clean --onedir --name clienthub-ai `
    --collect-data rapidocr_onnxruntime --collect-submodules rapidocr_onnxruntime `
    --collect-binaries onnxruntime --collect-binaries pypdfium2 --collect-binaries pypdfium2_raw `
    --exclude-module PyQt5 --exclude-module PySide6 `
    --distpath $distDir --workpath $workDir --specpath $specDir $entry
  if ($LASTEXITCODE -ne 0) { throw "Sidecar build failed" }
} finally {
  $env:PATH = $buildOriginalPath
}

$envFile = Join-Path $root "services\ai\.env"
$bundledEnv = Join-Path $outDir ".env"
if ($IncludeEnv -and (Test-Path $envFile)) {
  Copy-Item $envFile $bundledEnv -Force
  Write-Warning "Bundled local .env for an explicit test build; never use -IncludeEnv for a release."
} elseif (Test-Path $bundledEnv) {
  Remove-Item $bundledEnv -Force
  Write-Host "Removed stale bundled .env; packaged builds read credentials from the user's data directory"
}

# The workspace may stamp generated executables with Low integrity.
& icacls (Join-Path $outDir "clienthub-ai.exe") /setintegritylevel Medium | Out-Null

Write-Host "Built: $outDir\clienthub-ai.exe"
