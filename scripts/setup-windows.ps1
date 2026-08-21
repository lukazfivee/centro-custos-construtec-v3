$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectDir '.env'
$localBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
$appDataRoot = Join-Path $localBase 'Construtec\CentroCustos'
$pgliteDataDir = (Join-Path $appDataRoot 'pglite').Replace('\','/')
$restoreRootDir = (Join-Path $appDataRoot 'dados').Replace('\','/')
New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null

Write-Host ''
Write-Host 'CONFIGURACAO INICIAL DO CENTRO DE CUSTOS' -ForegroundColor Cyan
Write-Host 'Esta etapa acontece apenas uma vez nesta maquina.'
Write-Host ''

$instanceName = Read-Host 'Nome desta instalacao (ex.: Financeiro - Lucas)'
if ([string]::IsNullOrWhiteSpace($instanceName)) { $instanceName = "Instalacao $env:COMPUTERNAME" }
$adminName = Read-Host 'Nome do administrador'
if ([string]::IsNullOrWhiteSpace($adminName)) { $adminName = 'Administrador' }
$adminEmail = Read-Host 'E-mail do administrador'
if ([string]::IsNullOrWhiteSpace($adminEmail)) { $adminEmail = 'admin@empresa.com' }

do {
  $securePassword = Read-Host 'Crie uma senha com pelo menos 10 caracteres' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try { $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($adminPassword.Length -lt 10) { Write-Host 'A senha precisa ter pelo menos 10 caracteres.' -ForegroundColor Yellow }
} while ($adminPassword.Length -lt 10)

$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$jwtSecret = [Convert]::ToBase64String($bytes)

function Quote-DotEnv([string]$value) {
  return '"' + $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '') + '"'
}

$lines = @(
  "INSTANCE_NAME=$(Quote-DotEnv $instanceName)",
  "ADMIN_INITIAL_NAME=$(Quote-DotEnv $adminName)",
  "ADMIN_INITIAL_EMAIL=$(Quote-DotEnv $adminEmail)",
  "ADMIN_INITIAL_PASSWORD=$(Quote-DotEnv $adminPassword)",
  "JWT_SECRET=$(Quote-DotEnv $jwtSecret)",
  'PORT=3333',
  'HOST=127.0.0.1',
  'APP_TIMEZONE=America/Sao_Paulo',
  "PGLITE_DATA_DIR=$(Quote-DotEnv $pgliteDataDir)",
  "RESTORE_ROOT_DIR=$(Quote-DotEnv $restoreRootDir)"
)

[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Write-Host 'Configuracao salva. O sistema pode ser iniciado.' -ForegroundColor Green

