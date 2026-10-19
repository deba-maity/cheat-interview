@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node 24 LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node scripts\check-node.js
if errorlevel 1 (
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 (
  echo Installation failed. Read the error above before trying again.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo Build failed. No new portable executable was copied to this folder.
  pause
  exit /b 1
)
echo.
echo Done. Double-click Stealth Overlay.exe in this folder to open the app.
pause
