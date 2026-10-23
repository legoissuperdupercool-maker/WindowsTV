# CI smoke test for the custom setup window: screenshots its welcome and
# progress screens, runs a full silent install (/auto) into a temp folder and
# checks the app ended up there.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$setup = Get-ChildItem release -Filter 'ello-smartTV-*-Setup.exe' | Select-Object -First 1

function Snap([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $small = New-Object System.Drawing.Bitmap $bmp, 640, ([int](640 * $b.Height / $b.Width))
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  Write-Host "PREVIEW $name $([Convert]::ToBase64String($ms.ToArray()))"
  $g.Dispose(); $bmp.Dispose(); $small.Dispose()
}

# Welcome screen
$p = Start-Process -FilePath $setup.FullName -PassThru
Start-Sleep -Seconds 5
Snap 'setup-welcome'
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

# Full install
$dir = 'D:\ello-install-test\ello smartTV'
$p = Start-Process -FilePath $setup.FullName -ArgumentList '/auto', "`"/dir=$dir`"" -PassThru
Start-Sleep -Seconds 6
Snap 'setup-progress'
if (-not $p.WaitForExit(240000)) { Stop-Process -Id $p.Id -Force; throw 'Setup did not finish within 4 minutes.' }
$exe = Get-ChildItem $dir -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^Uninstall' } | Select-Object -First 1
Write-Host "Setup exit code: $($p.ExitCode); installed app: $($exe.FullName)"
if ($p.ExitCode -ne 0 -or -not $exe) { throw 'Custom setup did not install the app.' }
Write-Host 'RESULT custom setup installed the app OK'
