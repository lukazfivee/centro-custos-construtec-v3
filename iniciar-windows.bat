@echo off
setlocal
title Centro de Custos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ================================================================
  echo   Node.js nao foi encontrado.
  echo   Instale a versao LTS em https://nodejs.org e reinicie o Windows.
  echo ================================================================
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
  if errorlevel 1 (
    echo A configuracao inicial nao foi concluida.
    pause
    exit /b 1
  )
)

if not exist "node_modules\@electric-sql\pglite" (
  echo.
  echo Instalando os componentes locais. A internet e necessaria somente agora...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar os componentes. Verifique a internet e tente novamente.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando o Centro de Custos...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o sistema. Consulte o arquivo servidor.log.
  pause
  exit /b 1
)

echo Sistema iniciado. Esta janela pode ser fechada.
timeout /t 2 >nul
