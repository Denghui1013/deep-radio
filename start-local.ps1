$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$neteaseDir = Join-Path $root "NeteaseCloudMusicApi"
$backendEnvPath = Join-Path $backendDir ".env"
$backendEnvExamplePath = Join-Path $backendDir ".env.example"
$frontendEnvPath = Join-Path $frontendDir ".env"
$frontendEnvExamplePath = Join-Path $frontendDir ".env.example"

function Read-EnvFile {
  param([string]$Path)

  $result = @{}
  if (-not (Test-Path $Path)) {
    return $result
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    $eqIndex = $trimmed.IndexOf("=")
    if ($eqIndex -lt 0) {
      continue
    }
    $key = $trimmed.Substring(0, $eqIndex).Trim()
    $value = $trimmed.Substring($eqIndex + 1).Trim()
    $result[$key] = $value
  }

  return $result
}

function Get-PortFromUrl {
  param(
    [string]$Url,
    [int]$DefaultPort
  )

  if (-not $Url) {
    return $DefaultPort
  }

  try {
    $uri = [System.Uri]$Url
    if ($uri.Port -gt 0) {
      return [int]$uri.Port
    }
  } catch {
    throw "Invalid URL: $Url"
  }

  return $DefaultPort
}

function Assert-RequiredPath {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path $Path)) {
    throw "$Label not found: $Path"
  }
}

function Get-ListeningPortProcess {
  param([int]$Port)

  try {
    $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
    if ($connections) {
      return $connections | Select-Object -First 1
    }
  } catch {
    $netstatLine = netstat -ano | Select-String -Pattern "LISTENING\s+(\d+)$" | Where-Object {
      $_.Line -match "[:\.]$Port\s"
    } | Select-Object -First 1

    if ($netstatLine) {
      return $netstatLine.Line.Trim()
    }
  }

  return $null
}

function Assert-PortFree {
  param(
    [int]$Port,
    [string]$ServiceName
  )

  $listener = Get-ListeningPortProcess -Port $Port
  if ($listener) {
    throw "$ServiceName port $Port is already in use. Stop the existing process before starting Claudio."
  }
}

function Start-ServiceWindow {
  param(
    [string]$Title,
    [string]$WorkingDirectory,
    [string]$Command
  )

  $innerCommand = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkingDirectory'; $Command"
  Start-Process powershell -WorkingDirectory $WorkingDirectory -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $innerCommand
  )
}

Assert-RequiredPath -Path $backendDir -Label "Backend directory"
Assert-RequiredPath -Path $frontendDir -Label "Frontend directory"
Assert-RequiredPath -Path $neteaseDir -Label "NeteaseCloudMusicApi directory"
Assert-RequiredPath -Path (Join-Path $backendDir "node_modules") -Label "Backend dependencies"
Assert-RequiredPath -Path (Join-Path $frontendDir "node_modules") -Label "Frontend dependencies"
Assert-RequiredPath -Path (Join-Path $neteaseDir "node_modules") -Label "Netease dependencies"

$backendEnv = Read-EnvFile -Path $backendEnvExamplePath
if (Test-Path $backendEnvPath) {
  $backendOverrides = Read-EnvFile -Path $backendEnvPath
  foreach ($key in $backendOverrides.Keys) {
    $backendEnv[$key] = $backendOverrides[$key]
  }
}

$frontendEnv = Read-EnvFile -Path $frontendEnvExamplePath
if (Test-Path $frontendEnvPath) {
  $frontendOverrides = Read-EnvFile -Path $frontendEnvPath
  foreach ($key in $frontendOverrides.Keys) {
    $frontendEnv[$key] = $frontendOverrides[$key]
  }
}

$backendPort = if ($backendEnv.ContainsKey("PORT")) { [int]$backendEnv["PORT"] } else { 4000 }
$frontendPort = 5173
$backendUrl = "http://localhost:$backendPort"
$frontendBackendUrl = if ($frontendEnv.ContainsKey("VITE_BACKEND_URL")) { $frontendEnv["VITE_BACKEND_URL"] } else { $backendUrl }
$neteaseUrl = if ($backendEnv.ContainsKey("NETEASE_API_URL")) { $backendEnv["NETEASE_API_URL"] } else { "http://localhost:3000" }
$neteasePort = Get-PortFromUrl -Url $neteaseUrl -DefaultPort 3000

if (-not $backendEnv.ContainsKey("FAVORITE_PLAYLIST_ID") -or -not $backendEnv["FAVORITE_PLAYLIST_ID"]) {
  throw "backend/.env is missing FAVORITE_PLAYLIST_ID."
}

$hasCookie = (
  ($backendEnv.ContainsKey("NETEASE_COOKIE") -and $backendEnv["NETEASE_COOKIE"]) -or
  ($backendEnv.ContainsKey("NETEASE_COOKIE_FILE") -and $backendEnv["NETEASE_COOKIE_FILE"])
)
if (-not $hasCookie) {
  throw "backend/.env must provide NETEASE_COOKIE or NETEASE_COOKIE_FILE before local startup."
}

if ($frontendBackendUrl -ne $backendUrl) {
  throw "Frontend backend target ($frontendBackendUrl) does not match backend startup url ($backendUrl). Update frontend/.env or backend/.env first."
}

Assert-PortFree -Port $neteasePort -ServiceName "NeteaseCloudMusicApi"
Assert-PortFree -Port $backendPort -ServiceName "Backend"
Assert-PortFree -Port $frontendPort -ServiceName "Frontend"

Write-Host "Starting Claudio local workspace..." -ForegroundColor Cyan
Write-Host "Netease API: $neteaseUrl" -ForegroundColor DarkCyan
Write-Host "Backend: $backendUrl" -ForegroundColor DarkCyan
Write-Host "Frontend: http://localhost:$frontendPort" -ForegroundColor DarkCyan

Start-ServiceWindow -Title "Claudio - Netease API" -WorkingDirectory $neteaseDir -Command "npm.cmd start"
Start-Sleep -Seconds 1
Start-ServiceWindow -Title "Claudio - Backend" -WorkingDirectory $backendDir -Command "npm.cmd run dev"
Start-Sleep -Seconds 1
Start-ServiceWindow -Title "Claudio - Frontend" -WorkingDirectory $frontendDir -Command "npm.cmd run dev"

Write-Host "All service windows have been launched." -ForegroundColor Green
