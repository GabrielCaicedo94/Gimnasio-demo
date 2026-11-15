@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Descargalo de https://nodejs.org ^(version LTS^) e intenta de nuevo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias por primera vez, espera un momento...
  call npm install --omit=dev
  if errorlevel 1 ( echo Error instalando dependencias. & pause & exit /b 1 )
)
start "" http://localhost:3000
node --no-warnings app.js
pause
