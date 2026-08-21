$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$healthUrl = 'http://localhost:3333/api/health'
$appUrl = 'http://localhost:3333/'
$logPath = Join-Path $projectDir 'servidor.log'
$errorLogPath = Join-Path $projectDir 'servidor-erro.log'

function Test-Server {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
    return $response.status -eq 'ok'
  } catch {
    return $false
  }
}

if (-not (Test-Server)) {
  $scheduledTask = Get-ScheduledTask -TaskName 'Centro de Custos Local' -ErrorAction SilentlyContinue
  if ($scheduledTask) {
    Start-ScheduledTask -TaskName 'Centro de Custos Local'
  } else {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    Start-Process `
      -FilePath $nodePath `
      -ArgumentList 'server.js' `
      -WorkingDirectory $projectDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput $logPath `
      -RedirectStandardError $errorLogPath | Out-Null
  }

  $ready = $false
  # A primeira preparação do banco pode demorar um pouco em computadores
  # mais lentos ou em pastas sincronizadas pelo OneDrive.
  for ($attempt = 0; $attempt -lt 240; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-Server) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    throw "O servidor não respondeu. Consulte $errorLogPath"
  }
}

Start-Process $appUrl | Out-Null
Write-Host 'Centro de Custos iniciado em http://localhost:3333' -ForegroundColor Green
