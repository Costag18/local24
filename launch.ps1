# LOCAL 24 launcher.
# Installs and builds on first run, starts the local server if it is not already
# up, waits for it to answer, then opens it fullscreen in Chrome as a kiosk.
# Everything is logged to launcher.log so a failed launch can be diagnosed.

param(
  # Starts everything but leaves the browser alone. Used for checking a launch
  # without a kiosk window taking over the screen.
  [switch]$NoOpen
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$log = Join-Path $root 'launcher.log'
# The server writes to its own file. Sharing one log with the detached process
# locks it and makes every later Say silently fail mid-launch.
$serverLog = Join-Path $root 'server.log'
$port = 3100
$url = "http://127.0.0.1:$port"

function Say($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host "  $msg"
  Add-Content -Path $log -Value $line -Encoding utf8
}

# One launch at a time. A double-click on the shortcut used to run two
# launches side by side, and each opened its own kiosk window.
$mutex = New-Object System.Threading.Mutex($false, 'Local\LOCAL24Launcher')
if (-not $mutex.WaitOne(0)) { exit 0 }

Set-Content -Path $log -Value ("=== launch {0} ===" -f (Get-Date)) -Encoding utf8
Write-Host ""
Write-Host "  LOCAL 24"
Write-Host "  --------"
Write-Host ""

function Test-Up {
  try { return (Invoke-WebRequest -UseBasicParsing "$url/api/state" -TimeoutSec 4).StatusCode -eq 200 }
  catch { return $false }
}

# True when the code has changed since the last build (or there is no build).
# Without this a code change only took effect after a manual rebuild - the
# launcher happily served the old build forever.
function Test-BuildStale {
  $id = Join-Path $root '.next\BUILD_ID'
  if (-not (Test-Path $id)) { return $true }
  $built = (Get-Item $id).LastWriteTimeUtc
  $inputs = @(Get-ChildItem -Path (Join-Path $root 'src') -Recurse -File -ErrorAction SilentlyContinue)
  foreach ($f in 'package.json', 'next.config.ts', 'next.config.mjs', 'tsconfig.json') {
    $path = Join-Path $root $f
    if (Test-Path $path) { $inputs += Get-Item $path }
  }
  $newest = ($inputs | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
  return ($newest -gt $built)
}

# The kiosk's own Chrome (the browser process, not its helpers), if it is open.
function Get-KioskBrowser {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*kiosk-profile*' -and $_.CommandLine -notlike '*--type=*' }
}

# Brings an already-open kiosk window to the front instead of opening another.
function Show-KioskWindow {
  if (-not ('L24Win' -as [type])) {
    Add-Type -Namespace '' -Name 'L24Win' -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
'@
  }
  $shown = $false
  foreach ($k in Get-KioskBrowser) {
    $p = Get-Process -Id $k.ProcessId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) {
      [L24Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
      [L24Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
      $shown = $true
    }
  }
  return $shown
}

# Stops whatever is serving on the port, and waits until it has let go.
function Stop-Server {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($l in $listeners) { & taskkill /PID $l.OwningProcess /T /F 2>&1 | Out-Null }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 300
  }
}

try {
  # --- start the server unless it is already up ----------------------------
  # The liveness check comes first on purpose. A build wipes .next, so running
  # one while a server is already serving out of it takes that server down -
  # including the dev server, if that is what is answering.
  $stale = Test-BuildStale
  if ((Test-Up) -and $stale) {
    # A newer version is waiting. Open screens reload themselves when the new
    # build comes up, so nothing needs refreshing by hand afterwards.
    Say 'The code has changed since this build - updating...'
    Stop-Server
  }

  if (Test-Up) {
    Say "Already running on port $port."
  } else {
    # --- one-time setup ----------------------------------------------------
    if (-not (Test-Path (Join-Path $root 'node_modules\next'))) {
      Say 'Installing dependencies (one time, about a minute)...'
      & npm install 2>&1 | Out-File -Append -Encoding utf8 $serverLog
    }
    if ($stale) {
      Say 'Building (about a minute)...'
      & npm run build 2>&1 | Out-File -Append -Encoding utf8 $serverLog
      if (Test-BuildStale) {
        # Build workers occasionally collide opening the SQLite file; one
        # retry clears it, and a second failure is a real failure.
        Say 'Build did not finish - retrying once...'
        & npm run build 2>&1 | Out-File -Append -Encoding utf8 $serverLog
      }
      if (Test-BuildStale) {
        throw 'Build failed. See server.log.'
      }
    }

    Say "Starting server on port $port..."
    Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/d', '/c', "npm run start >> `"$serverLog`" 2>&1" `
      -WorkingDirectory $root -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Up)) {
      if ((Get-Date) -gt $deadline) { throw "Server did not answer on $url within 90s. See launcher.log." }
      Start-Sleep -Milliseconds 700
    }
    Say 'Server is up.'
  }

  # --- kick a data pull, but do not block the launch on it -----------------
  # The poller refreshes on its own timers; this just warms the cache. Waiting
  # for a full scrape here would leave the user looking at a blank console.
  Say 'Requesting a refresh in the background...'
  Start-Job -ScriptBlock {
    param($u)
    try {
      Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$u/api/refresh" `
        -ContentType 'application/json' -Body '{"job":"all"}' -TimeoutSec 180 | Out-Null
    } catch { }
  } -ArgumentList $url | Out-Null

  # --- open fullscreen -----------------------------------------------------
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($NoOpen) {
    Say 'Ready (browser not opened: -NoOpen).'
  } elseif (Get-KioskBrowser) {
    # Already open. Clicking the shortcut again used to stack a second kiosk
    # window on the first; now it just brings the existing one forward. (If
    # the server was rebuilt above, that window reloads itself.)
    Say 'Already open - bringing it to the front.'
    Show-KioskWindow | Out-Null
  } elseif ($chrome) {
    Say 'Opening in Chrome (kiosk).'
    # Its own profile, so the kiosk never inherits - or restores - the tabs
    # from everyday browsing, and nothing it opens lands back in them.
    $kioskProfile = Join-Path $root 'data\kiosk-profile'
    if (-not (Test-Path $kioskProfile)) { New-Item -ItemType Directory -Path $kioskProfile | Out-Null }
    # One string, not an array. This folder lives under "Dev Environment", and
    # an array argument list is joined with spaces and re-quoted by PowerShell,
    # which drops the quotes around the path - Chrome then read the profile as
    # far as "...\Dev" and treated "Environment\local24\..." as a URL to visit.
    # That is the "This site can't be reached: environment" page.
    $chromeArgs = '--kiosk --user-data-dir="{0}" --no-first-run ' +
      '--no-default-browser-check --restore-last-session=false ' +
      '--hide-crash-restore-bubble --disable-session-crashed-bubble ' +
      '--disable-features=InfiniteSessionRestore ' +
      '--autoplay-policy=no-user-gesture-required "{1}"'
    $chromeArgs = $chromeArgs -f $kioskProfile, "$url/?kiosk=1"
    Start-Process -FilePath $chrome -ArgumentList $chromeArgs | Out-Null
    # Remembered so the quit button can close this window and nothing else.
    # The process Start-Process returns can be a short-lived launcher that hands
    # off and exits, so wait for the real browser process and record that one.
    $deadline = (Get-Date).AddSeconds(8)
    do {
      Start-Sleep -Milliseconds 300
      $browser = Get-KioskBrowser | Select-Object -First 1
    } while (-not $browser -and (Get-Date) -lt $deadline)
    if ($browser) { Set-Content -Path (Join-Path $root 'data\kiosk.pid') -Value $browser.ProcessId -Encoding ascii }
  } else {
    Say 'Chrome not found; opening the default browser.'
    Start-Process "$url/?kiosk=1"
  }

  Say 'Done.'
  Write-Host ""
  Write-Host "  Open:     $url"
  Write-Host "  Settings: $url/settings"
  Write-Host "  Health:   $url/health"

  # The server listens on every interface, so anything else on the house
  # network can open it by address - a phone, a tablet, another laptop.
  $lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($lan) {
    Write-Host ""
    Write-Host "  On this network:  http://${lan}:$port"
    if (-not (Get-NetFirewallRule -DisplayName 'LOCAL 24' -ErrorAction SilentlyContinue)) {
      Write-Host "  (if another device cannot reach it, run tools\allow-lan.ps1 as administrator - once)"
    }
  }
  Write-Host ""
} catch {
  Say "FAILED: $($_.Exception.Message)"
  Write-Host ""
  Write-Host "  Something went wrong. See launcher.log."
  Write-Host ""
  Read-Host '  Press Enter to close'
}
