@echo off
title Build Virtual Pet.exe
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 goto fail

echo Building Virtual Pet.exe...
call npm run build
if errorlevel 1 goto fail

set "EXE_DIST=build-output\Virtual Pet 1.60.0.exe"
set "EXE_ROOT=Virtual Pet.exe"

if not exist "%EXE_DIST%" (
  echo Expected file not found: %EXE_DIST%
  goto fail
)

copy /Y "%EXE_DIST%" "%EXE_ROOT%" >nul
echo.
echo Done!
echo   %EXE_ROOT%  ^(main launcher — double-click this^)
echo   %EXE_DIST%
echo.
explorer "build-output"
goto end

:fail
echo Build failed.
pause
exit /b 1

:end
pause
