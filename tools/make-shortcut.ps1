# Builds the LOCAL 24 icon and puts a shortcut to the launcher on the desktop.
# Re-runnable: it overwrites both rather than piling up copies.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcher = Join-Path $root 'LOCAL 24.cmd'
$serverLauncher = Join-Path $root 'LOCAL 24 Server.cmd'
$icoPath = Join-Path $root 'local24.ico'
$serverIcoPath = Join-Path $root 'local24-server.ico'

if (-not (Test-Path $launcher)) { throw "Launcher not found at $launcher" }
if (-not (Test-Path $serverLauncher)) { throw "Launcher not found at $serverLauncher" }

Add-Type -AssemblyName System.Drawing

# --- the artwork ------------------------------------------------------------
# The dashboard's wordmark: white LOCAL 24 on a red band over a dark rounded
# square. Drawn fresh at each size rather than scaled, so the small ones stay
# legible instead of turning to mush. The server-only shortcut gets the same
# mark on a blue band reading SERVER, so the two are told apart at a glance.
function New-Local24Bitmap([int]$size, [int[]]$band = @(225, 29, 46), [string]$word = 'LOCAL') {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.InterpolationMode = 'HighQualityBicubic'

  $radius = [Math]::Max(3, [int]($size * 0.17))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $radius, $radius, 180, 90)
  $path.AddArc($size - $radius, 0, $radius, $radius, 270, 90)
  $path.AddArc($size - $radius, $size - $radius, $radius, $radius, 0, 90)
  $path.AddArc(0, $size - $radius, $radius, $radius, 90, 90)
  $path.CloseFigure()

  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 8, 11, 18))
  $g.FillPath($dark, $path)
  $g.SetClip($path)

  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $band[0], $band[1], $band[2]))
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'

  if ($size -le 32) {
    # Too small for two words: the red square with "24" is the recognisable part.
    $g.FillRectangle($red, 0, 0, $size, [int]($size * 0.30))
    $f = New-Object System.Drawing.Font('Segoe UI', [float]($size * 0.60), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawString('24', $f, $white, (New-Object System.Drawing.RectangleF(0, [float]($size * 0.28), $size, [float]($size * 0.72))), $fmt)
    $f.Dispose()
  } else {
    $bandH = [int]($size * 0.375)
    $g.FillRectangle($red, 0, 0, $size, $bandH)
    $wordSize = if ($word.Length -gt 5) { 0.14 } else { 0.165 }
    $fLocal = New-Object System.Drawing.Font('Segoe UI', [float]($size * $wordSize), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fNum = New-Object System.Drawing.Font('Segoe UI', [float]($size * 0.44), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawString($word, $fLocal, $white, (New-Object System.Drawing.RectangleF(0, 0, $size, $bandH)), $fmt)
    # The parentheses matter: a comma binds tighter than a minus here, so an
    # unwrapped `$size - $bandH` would try to subtract from the argument array.
    $g.DrawString('24', $fNum, $white, (New-Object System.Drawing.RectangleF(0, $bandH, $size, ($size - $bandH))), $fmt)
    $fLocal.Dispose(); $fNum.Dispose()
  }

  $g.ResetClip()
  $g.Dispose()
  $red.Dispose(); $white.Dispose(); $dark.Dispose(); $path.Dispose()
  return $bmp
}

# --- the .ico container -----------------------------------------------------
# Every size is stored as an uncompressed 32-bit DIB rather than a PNG: PNG
# entries are what Explorer prefers, but GDI+ cannot read them at all, so a
# PNG-only icon renders as nothing anywhere that falls back to it.
function New-IcoEntry([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $data = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($data)

  # BITMAPINFOHEADER. The doubled height covers the AND mask that follows.
  $bw.Write([UInt32]40); $bw.Write([Int32]$w); $bw.Write([Int32]($h * 2))
  $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
  $bw.Write([UInt32]($w * $h * 4)); $bw.Write([Int32]0); $bw.Write([Int32]0)
  $bw.Write([UInt32]0); $bw.Write([UInt32]0)

  # BGRA pixels, bottom row first.
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $locked = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $locked.Stride
  $buf = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $buf, 0, $buf.Length)
  $bmp.UnlockBits($locked)
  for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($buf, $y * $stride, $w * 4) }

  # AND mask: all zero, because the alpha channel already carries the shape.
  $maskRow = [int](([Math]::Floor(($w + 31) / 32)) * 4)
  $bw.Write((New-Object byte[] ($maskRow * $h)))

  $bw.Flush()
  $bytes = $data.ToArray()
  $bw.Dispose(); $data.Dispose()
  # The leading comma stops PowerShell unrolling the array into the pipeline,
  # which would hand the caller a few thousand loose bytes instead of a blob.
  return ,$bytes
}

function Write-Icon([string]$path, [int[]]$band, [string]$word) {
  $sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
  $images = @()
  foreach ($s in $sizes) {
    $bmp = New-Local24Bitmap $s $band $word
    $images += , @{ size = $s; bytes = (New-IcoEntry $bmp) }
    $bmp.Dispose()
  }

  $ico = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter($ico)
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$images.Count)

  # Entries first, then the payloads they point at.
  $offset = 6 + (16 * $images.Count)
  foreach ($img in $images) {
    $dim = if ($img.size -ge 256) { 0 } else { $img.size }   # 0 means 256
    $w.Write([Byte]$dim); $w.Write([Byte]$dim)
    $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$img.bytes.Length); $w.Write([UInt32]$offset)
    $offset += $img.bytes.Length
  }
  foreach ($img in $images) { $w.Write([byte[]]$img.bytes) }
  $w.Flush()
  [System.IO.File]::WriteAllBytes($path, $ico.ToArray())
  $w.Dispose(); $ico.Dispose()
  Write-Host ("  icon      {0} ({1} sizes, {2:n0} bytes)" -f $path, $images.Count, (Get-Item $path).Length)
}

Write-Icon $icoPath @(225, 29, 46) 'LOCAL'
Write-Icon $serverIcoPath @(37, 99, 235) 'SERVER'

# --- the shortcuts ----------------------------------------------------------
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function Write-Shortcut([string]$name, [string]$target, [string]$icon, [string]$about) {
  $lnkPath = Join-Path $desktop "$name.lnk"
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = $about
  $lnk.WindowStyle = 1
  $lnk.Save()
  Write-Host "  shortcut  $lnkPath"
}

Write-Shortcut 'LOCAL 24' $launcher $icoPath 'Start LOCAL 24 and open it fullscreen'
Write-Shortcut 'LOCAL 24 Server' $serverLauncher $serverIcoPath 'Start the LOCAL 24 server only, for watching on another screen'
