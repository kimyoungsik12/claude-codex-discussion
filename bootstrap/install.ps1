# User-owned Node bootstrap, compatible with Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param(
  [switch]$RuntimeOnly,
  [switch]$Private,
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'claude-codex-discussion\runtime'),
  [ValidateSet('both','claude','codex')][string]$Target = 'both',
  [string]$PackageRoot = ''
)
$ErrorActionPreference = 'Stop'
$version = '22.22.2'
function Test-Node([string]$Executable) {
  try { & $Executable -e 'process.exit(parseInt(process.versions.node)>=22?0:1)' 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
}
if (-not [IO.Path]::IsPathRooted($Root)) { throw 'Runtime root must be absolute' }
$nodePath = $null
if (-not $Private) {
  $existing = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing -and (Test-Node $existing.Source)) { $nodePath = $existing.Source }
}
if (-not $nodePath) {
  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  switch ($architecture) {
    'X64' { $arch = 'x64'; $checksum = '7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c' }
    'ARM64' { $arch = 'arm64'; $checksum = '380d375cf650c5a7f2ef3ce29ac6ea9a1c9d2ec8ea8e8391e1a34fd543886ab3' }
    default { throw "Unsupported architecture: $architecture" }
  }
  $name = "node-v$version-win-$arch"
  [IO.Directory]::CreateDirectory($Root) | Out-Null
  $Root = (Resolve-Path -LiteralPath $Root).Path
  $destination = Join-Path $Root $name
  $nodePath = Join-Path $destination 'node.exe'
  if (-not (Test-Path -LiteralPath $nodePath)) {
    $lockPath = Join-Path $Root '.install-lock'
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $stage = Join-Path $Root ('.stage-' + [guid]::NewGuid().ToString())
    try {
      [IO.Directory]::CreateDirectory($stage) | Out-Null
      $archive = Join-Path $stage 'node.zip'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$version/$name.zip" -OutFile $archive -TimeoutSec 300
      $stream = [IO.File]::OpenRead($archive)
      $hasher = [Security.Cryptography.SHA256]::Create()
      try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose(); $hasher.Dispose() }
      if ($actual -ne $checksum) { throw 'Node SHA-256 mismatch; archive rejected' }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
      $stagedNode = Join-Path $stage "$name\node.exe"
      if (-not (Test-Node $stagedNode)) { throw 'Downloaded Node cannot run on this Windows version' }
      if (Test-Path -LiteralPath $destination) { throw 'Existing private runtime is incomplete; inspect it before replacing' }
      Move-Item -LiteralPath (Join-Path $stage $name) -Destination $destination
    } finally {
      # Only delete the checked staging child created by this invocation.
      $fullStage = [IO.Path]::GetFullPath($stage)
      if ($fullStage.StartsWith($Root + [IO.Path]::DirectorySeparatorChar) -and (Split-Path $fullStage -Leaf).StartsWith('.stage-')) {
        if (Test-Path -LiteralPath $fullStage) { Remove-Item -LiteralPath $fullStage -Recurse -Force }
      }
      $lock.Dispose()
    }
  }
  if (-not (Test-Node $nodePath)) { throw 'Private runtime is unusable; no system changes made' }
}
Write-Output $nodePath
if ($RuntimeOnly) { return }
if (-not $PackageRoot) {
  $bundledRoot = Split-Path $PSScriptRoot -Parent
  if ((Test-Path -LiteralPath (Join-Path $bundledRoot 'dist\cli.cjs')) -and (Test-Path -LiteralPath (Join-Path $bundledRoot 'skill\SKILL.md'))) { $PackageRoot = $bundledRoot }
}
$oldPath = $env:PATH
try {
  $env:PATH = (Split-Path $nodePath) + [IO.Path]::PathSeparator + $oldPath
  if ($PackageRoot) {
    $cli = Join-Path $PackageRoot 'dist\cli.cjs'
    if (-not (Test-Path -LiteralPath $cli)) { throw 'Built package required' }
    & $nodePath $cli install --target $Target
  } else {
    $npx = Get-Command npx.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npx) { throw 'Node exists but npm/npx is missing; retry with -Private' }
    & $npx.Source --yes '@youngsik1/claude-codex-discussion@2.2.0' install --target $Target
  }
  if ($LASTEXITCODE -ne 0) { throw 'Skill installation failed' }
} finally { $env:PATH = $oldPath }
