@echo off
setlocal
title Centro de Custos - Teste ChatGPT FINAL
cd /d "%~dp0"

echo.
echo ================================================================
echo   CENTRO DE CUSTOS - VERSAO DE TESTE CHATGPT FINAL
 echo ================================================================
echo.
echo Esta copia usa a porta 3334 e um banco separado.
echo Nenhum dado da versao principal sera alterado.
echo.
echo NOVIDADES DESTA VERSAO:
echo - mantem melhorias de desempenho, paginacao e estorno das P0/P1/P2;
echo - mantem sincronizacao inteligente P3 e documentos P4;
echo - adiciona COCKPIT INTELIGENTE com central de atencao;
echo - adiciona fluxo de caixa projetado, curva ABC e tendencia por obra;
echo - adiciona contas financeiras e conciliacao de extrato, inclusive Cora;
echo - adiciona sugestoes pelo historico, visoes salvas e acoes em massa;
echo - adiciona rateio entre centros de custo pela API;
echo - adiciona backup automatico configuravel com retencao.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado neste computador.
  echo O site de instalacao sera aberto agora.
  echo Instale a versao LTS, reinicie o computador e execute este arquivo novamente.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist ".env" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-test-chatgpt.ps1"
  if errorlevel 1 (
    echo.
    echo A configuracao de teste nao foi concluida.
    pause
    exit /b 1
  )
)

if not exist "node_modules\@electric-sql\pglite" (
  echo.
  echo Instalando os componentes. Isto pode demorar alguns minutos...
  echo A internet e necessaria somente nesta primeira instalacao.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar os componentes.
    echo Verifique a internet e tente novamente.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando a versao final de teste...
echo O navegador abrira automaticamente em alguns segundos.
echo.
echo IMPORTANTE: mantenha esta janela preta aberta enquanto estiver testando.
echo Para encerrar o teste, volte aqui e pressione Ctrl+C.
echo.

start "" powershell.exe -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:3334/teste-chatgpt.html'"
call npm start

echo.
echo A versao de teste foi encerrada.
pause
