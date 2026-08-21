$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectDir '.env'
$dataRoot = Join-Path $projectDir 'dados-chatgpt'
$pgliteDataDir = (Join-Path $dataRoot 'pglite').Replace('\','/')
$restoreRootDir = $dataRoot.Replace('\','/')

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

Write-Host ''
Write-Host 'CONFIGURACAO DA VERSAO DE TESTE CHATGPT' -ForegroundColor Cyan
Write-Host 'Esta copia usa banco e porta separados da versao principal.'
Write-Host ''

$adminName = Read-Host 'Digite seu nome'
if ([string]::IsNullOrWhiteSpace($adminName)) { $adminName = 'Administrador de Teste' }
$adminEmail = Read-Host 'Digite um e-mail para entrar no teste'
if ([string]::IsNullOrWhiteSpace($adminEmail)) { $adminEmail = 'admin@teste.local' }

do {
  $securePassword = Read-Host 'Crie uma senha de teste com pelo menos 10 caracteres' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try { $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($adminPassword.Length -lt 10) {
    Write-Host 'A senha precisa ter pelo menos 10 caracteres.' -ForegroundColor Yellow
  }
} while ($adminPassword.Length -lt 10)

$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$jwtSecret = [Convert]::ToBase64String($bytes)

function Quote-DotEnv([string]$value) {
  return '"' + $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '') + '"'
}

$lines = @(
  'INSTANCE_NAME="Teste ChatGPT"',
  "ADMIN_INITIAL_NAME=$(Quote-DotEnv $adminName)",
  "ADMIN_INITIAL_EMAIL=$(Quote-DotEnv $adminEmail)",
  "ADMIN_INITIAL_PASSWORD=$(Quote-DotEnv $adminPassword)",
  "JWT_SECRET=$(Quote-DotEnv $jwtSecret)",
  'PORT=3334',
  'HOST=127.0.0.1',
  'APP_TIMEZONE=America/Sao_Paulo',
  'NODE_ENV=development',
  'LOG_LEVEL=info',
  "PGLITE_DATA_DIR=$(Quote-DotEnv $pgliteDataDir)",
  "RESTORE_ROOT_DIR=$(Quote-DotEnv $restoreRootDir)"
)

[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Write-Host 'Ambiente de teste configurado com sucesso.' -ForegroundColor Green
Write-Host 'Guarde o e-mail e a senha que acabou de criar.' -ForegroundColor Cyan
Write-Host ''
