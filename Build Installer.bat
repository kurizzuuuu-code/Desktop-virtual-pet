@echo off
title Build Desktop Gremlin Installer
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

echo Building Desktop Gremlin Setup Installer...
call npm run build:installer
if errorlevel 1 goto fail

echo.
echo ========================================================
echo Done! Setup installer generated in "build-output".
for %%f in ("build-output\Desktop Gremlin Setup *.exe") do set "SETUP_EXE=%%~nxf"
if defined SETUP_EXE (
  echo Run "%SETUP_EXE%" to install the app.
) else (
  echo Run "Desktop Gremlin Setup 1.81.10.exe" to install the app.
)
echo ========================================================
echo.
explorer "build-output"
goto end

:fail
echo Build failed.
pause
exit /b 1

:end
pause
