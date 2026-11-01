param(
  [string]$Python = "python",
  [switch]$IncludeEnv
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
  & $Python -m PyInstaller --noconfirm --clean --onefile --name clienthub-ai `
    --collect-all rapidocr_onnxruntime --collect-all onnxruntime --collect-all pypdfium2 --collect-all pypdfium2_raw `
    --distpath $outDir --workpath $workDir --specpath $specDir $entry
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

# One-file PyInstaller builds must run at Medium integrity to create their
# extraction temp dir; the workspace may stamp files with Low integrity.
& icacls (Join-Path $outDir "clienthub-ai.exe") /setintegritylevel Medium | Out-Null

Write-Host "Built: $outDir\clienthub-ai.exe"
