@echo off
chcp 65001 >nul
echo Deteniendo el sistema Gym Manager...
set HALLADO=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
  set HALLADO=1
)
if "%HALLADO%"=="1" ( echo Sistema detenido. ) else ( echo El sistema no estaba en ejecucion. )
timeout /t 3 >nul
