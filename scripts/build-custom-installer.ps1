# Builds the custom "ello smartTV" setup window (installer/) and appends the
# electron-builder NSIS installer to it, producing release/ello-smartTV-<v>-Setup.exe.
# Run after `electron-builder --win` (needs release/*-Setup-Classic.exe and
# release/win-unpacked). Windows only (WPF / .NET Framework 4.8).
$ErrorActionPreference = 'Stop'

$version = (node -p "require('./package.json').version").Trim()
dotnet build installer/ElloSetup.csproj -c Release -o installer/out --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Building the setup window failed.' }

$nsis = Get-ChildItem release -Filter "*-Setup-Classic.exe" | Select-Object -First 1
if (-not $nsis) { throw 'NSIS installer (*-Setup-Classic.exe) not found in release/.' }
$installedSize = (Get-ChildItem release/win-unpacked -Recurse -File | Measure-Object Length -Sum).Sum

$out = Join-Path (Resolve-Path release) "ello-smartTV-$version-Setup.exe"
$fs = [IO.File]::Create($out)
try {
  foreach ($part in @((Resolve-Path installer/out/ElloSetup.exe).Path, $nsis.FullName)) {
    $in = [IO.File]::OpenRead($part); $in.CopyTo($fs); $in.Dispose()
  }
  # Trailer: version (32 bytes) · installed size · payload length · magic.
  $ver = New-Object byte[] 32
  $vb = [Text.Encoding]::ASCII.GetBytes($version); [Array]::Copy($vb, $ver, [Math]::Min(32, $vb.Length))
  $fs.Write($ver, 0, 32)
  $fs.Write([BitConverter]::GetBytes([long]$installedSize), 0, 8)
  $fs.Write([BitConverter]::GetBytes([long]$nsis.Length), 0, 8)
  $magic = [Text.Encoding]::ASCII.GetBytes('ELLOPKG1'); $fs.Write($magic, 0, 8)
} finally { $fs.Dispose() }
Write-Host "Custom installer: $out ($([Math]::Round((Get-Item $out).Length / 1MB)) MB)"
