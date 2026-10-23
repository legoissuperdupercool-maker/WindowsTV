# CI video test: launches the unpacked app, auto-plays a generated test pattern,
# screenshots the desktop and reports how much of the screen shows the
# (very colourful) pattern. Run on a Windows runner after `electron-builder --dir`.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$exe = Get-ChildItem -Path release/win-unpacked -Filter *.exe | Where-Object { $_.Name -notmatch 'Uninstall' } | Select-Object -First 1
$mpv = (Resolve-Path resources/mpv/mpv.exe).Path
$testUrl = 'av://lavfi:testsrc2=size=1280x720:rate=30'
New-Item -ItemType Directory -Force -Path shots | Out-Null

function Measure-Screen([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save("shots/$name.png")
  $colour = 0; $total = 0
  for ($y = 0; $y -lt $b.Height; $y += 8) {
    for ($x = 0; $x -lt $b.Width; $x += 8) {
      $p = $bmp.GetPixel($x, $y); $total++
      $mx = [Math]::Max($p.R, [Math]::Max($p.G, $p.B)); $mn = [Math]::Min($p.R, [Math]::Min($p.G, $p.B))
      if ($mx - $mn -gt 80) { $colour++ }
    }
  }
  $pct = [Math]::Round(100 * $colour / $total, 1)
  Write-Host "RESULT $name : $pct% of screen is test-pattern colour (screen $($b.Width)x$($b.Height))"
  # Small JPEG preview in the log so it can be inspected without artifacts.
  $small = New-Object System.Drawing.Bitmap $bmp, 320, ([int](320 * $b.Height / $b.Width))
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  Write-Host "PREVIEW $name $([Convert]::ToBase64String($ms.ToArray()))"
  $g.Dispose(); $bmp.Dispose(); $small.Dispose()
}

# 1) Control: mpv on its own window — proves mpv can draw on this machine.
$p = Start-Process -FilePath $mpv -ArgumentList '--force-window=yes', '--geometry=800x450+0+0', '--log-file=shots/mpv-control.log', $testUrl -PassThru
Start-Sleep -Seconds 10
Measure-Screen 'control-mpv-alone'
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 2) The app, with each video-surface variant.
foreach ($mode in @('base', 'browser')) {
  $env:ELLO_TEST_PLAY = $testUrl
  $env:ELLO_VIDEO_WINDOW = $mode
  $env:ELLO_MPV_LOG = (Join-Path (Get-Location) "shots/mpv-$mode.log")
  $p = Start-Process -FilePath $exe.FullName -PassThru
  Start-Sleep -Seconds 25
  Measure-Screen "app-$mode"
  Get-Process | Where-Object { $_.Name -match 'ello|mpv' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Write-Host "---- mpv log ($mode), warnings/errors and vo lines:"
  if (Test-Path "shots/mpv-$mode.log") {
    Select-String -Path "shots/mpv-$mode.log" -Pattern '\[e\]|\[w\]|vo/|VO:|wid|d3d11|Error' | Select-Object -First 40 | ForEach-Object { $_.Line }
  } else { Write-Host '(no mpv log written)' }
}
Write-Host "---- control mpv log:"
Select-String -Path shots/mpv-control.log -Pattern '\[e\]|\[w\]|VO:' | Select-Object -First 20 | ForEach-Object { $_.Line }
