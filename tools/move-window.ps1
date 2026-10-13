# Moves a window to the next monitor and fills that screen.
#
# Chrome's kiosk window is borderless and sized to one display, so moving it is
# a matter of repositioning it onto the next display's bounds. Called by the
# dashboard's monitor button through /api/display.

param(
  [Parameter(Mandatory = $true)][int]$ProcessId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(
    IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$screens = [System.Windows.Forms.Screen]::AllScreens
if ($screens.Count -lt 2) {
  Write-Output 'only one monitor'
  exit 0
}

# The kiosk runs several Chrome processes; the one with a window is the window.
$handles = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -ExpandProperty MainWindowHandle
if (-not $handles) {
  $handles = Get-Process -Name chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*LOCAL 24*' } |
    Select-Object -First 1 -ExpandProperty MainWindowHandle
}
if (-not $handles) {
  Write-Output 'no window found'
  exit 1
}

$hwnd = [IntPtr]($handles | Select-Object -First 1)

# Which screen is it on now, and which comes next in the list.
$current = [System.Windows.Forms.Screen]::FromHandle($hwnd)
$index = 0
for ($i = 0; $i -lt $screens.Count; $i++) {
  if ($screens[$i].DeviceName -eq $current.DeviceName) { $index = $i }
}
$target = $screens[($index + 1) % $screens.Count]
$b = $target.Bounds

# SWP_NOZORDER | SWP_NOACTIVATE is deliberately not used: the window should
# come forward on the screen it lands on.
[Win]::ShowWindow($hwnd, 9) | Out-Null          # restore, in case it is maximized
[Win]::SetWindowPos($hwnd, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0040) | Out-Null
[Win]::SetForegroundWindow($hwnd) | Out-Null

Write-Output ("moved to {0} ({1}x{2})" -f $target.DeviceName, $b.Width, $b.Height)
