# Opens port 3100 to the local network so other devices in the house can open
# the dashboard. Run once, as administrator. Private networks only - the rule
# does not apply on a public Wi-Fi profile, which is the behaviour you want.

$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host ""
  Write-Host "  This needs administrator rights."
  Write-Host "  Right-click tools\allow-lan.ps1 and choose 'Run with PowerShell' as admin,"
  Write-Host "  or run from an elevated prompt:"
  Write-Host ""
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Write-Host ""
  exit 1
}

$existing = Get-NetFirewallRule -DisplayName 'LOCAL 24' -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "  Rule already present - nothing to do."
} else {
  New-NetFirewallRule -DisplayName 'LOCAL 24' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 3100 -Profile Private `
    -Description 'LOCAL 24 dashboard, reachable from the home network' | Out-Null
  Write-Host "  Port 3100 is now open on private networks."
}

$lan = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if ($lan) { Write-Host "  Other devices: http://${lan}:3100" }
