param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$workspace = 'D:\code\Basu-Custom-Platform'
$tempRoot = 'C:\Users\111\AppData\Local\Temp'
if ([IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)) -ne $workspace) {
  throw 'Run this script from the audited ClientHub workspace.'
}
if (Get-Process -Name ClientHub, clienthub-ai -ErrorAction SilentlyContinue) {
  throw 'Close ClientHub and its sidecar before cleaning test files.'
}

# Exact local paths audited on 2026-11-03. Keep final installers,
# build icons, acceptance logs/JSON, source files and real application data.
$workspacePaths = @(
  'build\ai-sidecar', 'build\ai-sidecar-spec', 'build\chrome-home-profile',
  'build\installer-fixtures', 'build\packaged-recognition-data',
  'build\packaged-recognition-data2', 'build\packaged-recognition-data3',
  'build\recognition-smoke', 'build\recognition-ui-data', 'build\release-v0.2.7',
  'build\test-py312', 'build\vm-transfer', 'build\home-smoke.png',
  'build\delivery-api17\python', 'build\delivery-api17\previous-api15.exe',
  'build\installed-app-smoke.cjs', 'build\installed-clarification.png',
  'build\installed-print.html', 'build\installed-ui-questions.docx',
  'build\installer-desktop.png', 'build\installer-fixtures.py',
  'build\installer-probe.cjs', 'build\installer-probe.png',
  'build\installer-questions.docx', 'build\packaged-api-smoke.cjs',
  'build\rdp-control.ps1', 'build\rdp-desktop.png', 'build\vm-acceptance.rdp',
  'build\window-inspect.ps1', 'release\win-unpacked', 'release\ai-sidecar',
  'release\builder-debug.yml', 'release\ClientHub Setup 0.2.6.exe'
)
$tempPaths = @(
  'clienthub-build-venv-312-0ee0a365cff64371b0e105c0de4904f1',
  'ClientHub-final-smoke-20261103', 'ClientHub-smoke-install',
  'clienthub-home-check', 'clienthub-home-check-2', 'clienthub-mobile-edge',
  'clienthub-installed-PcUGMl', 'clienthub-installed-PYqQUj',
  'clienthub-installer-probe-KIQZz9', 'clienthub-installer-probe-N6CgJC',
  'clienthub-installer-probe-SsGxti', 'clienthub-packaged-api-kHcmbc',
  'clienthub-packaged-sidecar-data', 'clienthub-sidecar-smoke-data',
  'clienthub-todo-v028', 'clienthub-todo-v028-final',
  'ClientHub-delivery-api17-20261103', 'ClientHub-delivery-profile-api17-20261103',
  '_MEI0000154c2', '_MEI00001e142', '_MEI000038a42', '_MEI00004c702',
  '_MEI000099382', '_MEI0000aafc2', '_MEI0000ac402', '_MEI0000bf482',
  '_MEI0000e0342', '_MEI0000e28c2', '_MEI0000ebfc2', '_MEI0000ecdc2',
  '_MEI0000ef782', '_MEI0000f6d02'
)

$targets = @(
  foreach ($group in @(
    @{ Root = $workspace; Paths = $workspacePaths },
    @{ Root = $tempRoot; Paths = $tempPaths }
  )) {
    foreach ($relative in $group.Paths) {
      $path = [IO.Path]::GetFullPath((Join-Path $group.Root $relative))
      if (!$path.StartsWith($group.Root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Cleanup target outside its audited root: $path"
      }
      if (!(Test-Path -LiteralPath $path)) { continue }
      $item = Get-Item -LiteralPath $path -Force
      $children = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $path -Recurse -Force) } else { @() }
      if (@($item) + $children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
        throw "Cleanup target contains a reparse point: $path"
      }
      $bytes = (@($item) + $children | Where-Object { !$_.PSIsContainer } | Measure-Object Length -Sum).Sum
      [pscustomobject]@{ Path = $path; Bytes = [long]$bytes }
    }
  }
)
$targets | Format-Table Path, Bytes -AutoSize
$total = ($targets | Measure-Object Bytes -Sum).Sum
Write-Host ('Audited local temporary files: {0:N2} GiB' -f ($total / 1GB))
if (!$Apply) {
  Write-Host 'Preview only. Run again with -Apply to delete these exact paths.'
  return
}
foreach ($target in $targets) {
  Remove-Item -LiteralPath $target.Path -Recurse -Force
  if (Test-Path -LiteralPath $target.Path) { throw "Cleanup did not remove: $($target.Path)" }
}
Write-Host ('Removed {0} local targets, {1:N2} GiB of file contents.' -f $targets.Count, ($total / 1GB))
